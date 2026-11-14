"""Resumable, idempotent downloader for the source datasets in pipeline/sources.json.

Stdlib only so it can run before the virtualenv exists.

    python pipeline/jobs/download.py --tier 1            # everything up to tier 1
    python pipeline/jobs/download.py --only ldem-80s-80m # a single source

Each finished file is recorded in data/manifest.json (url, path, size, sha256,
license). Re-running skips files whose size (and sha256, when pinned) match.
"""
from __future__ import annotations

import argparse
import hashlib
import html.parser
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
RAW = DATA / "raw"
MANIFEST = DATA / "manifest.json"
SOURCES = ROOT / "pipeline" / "sources.json"
UA = "lunar-site-explorer-pipeline/1.0"
CHUNK = 1 << 20


def _ctx() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # pragma: no cover - certifi optional
        return ssl.create_default_context()


CTX = _ctx()


def _open(url: str, headers: dict[str, str] | None = None, method: str = "GET"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})}, method=method)
    return urllib.request.urlopen(req, context=CTX, timeout=60)


def remote_size(url: str) -> int | None:
    try:
        with _open(url, method="HEAD") as r:
            n = r.headers.get("Content-Length")
            return int(n) if n else None
    except Exception:
        return None


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(CHUNK * 4), b""):
            h.update(b)
    return h.hexdigest()


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"version": 1, "files": {}}


def save_manifest(m: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(m, indent=1, sort_keys=True))
    tmp.replace(MANIFEST)


def fetch(url: str, dest: Path, expect_size: int | None, expect_sha: str | None, retries: int = 5) -> tuple[int, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = expect_size or remote_size(url)
    if dest.exists() and size is not None and dest.stat().st_size == size:
        digest = sha256_of(dest)
        if not expect_sha or digest == expect_sha:
            print(f"  ok (cached) {dest.relative_to(DATA)} {size/1e6:.1f} MB")
            return size, digest
        print(f"  sha256 mismatch for cached {dest.name}; re-downloading")
        dest.unlink()
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, retries + 1):
        have = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={have}-"} if have else {}
        try:
            with _open(url, headers) as r, part.open("ab" if have and r.status == 206 else "wb") as f:
                if have and r.status != 206:
                    have = 0
                total = size or (have + int(r.headers.get("Content-Length") or 0)) or None
                done, t0, last = have, time.time(), 0.0
                for b in iter(lambda: r.read(CHUNK), b""):
                    f.write(b)
                    done += len(b)
                    if time.time() - last > 15:
                        last = time.time()
                        pct = f"{100*done/total:5.1f}%" if total else ""
                        rate = (done - have) / max(1e-3, time.time() - t0) / 1e6
                        print(f"  .. {dest.name} {done/1e6:8.1f} MB {pct} {rate:5.1f} MB/s", flush=True)
            got = part.stat().st_size
            if size is not None and got != size:
                raise IOError(f"size {got} != expected {size}")
            digest = sha256_of(part)
            if expect_sha and digest != expect_sha:
                part.unlink()
                raise IOError("sha256 mismatch")
            part.replace(dest)
            print(f"  done {dest.relative_to(DATA)} {got/1e6:.1f} MB sha256={digest[:16]}...")
            return got, digest
        except (urllib.error.URLError, IOError, TimeoutError) as e:
            print(f"  attempt {attempt}/{retries} failed for {url}: {e}", file=sys.stderr)
            time.sleep(min(30, 2 ** attempt))
    raise SystemExit(f"FAILED: {url}")


class _Links(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):  # noqa: D401
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self.links.append(v)


def list_dir(url: str) -> list[str]:
    with _open(url) as r:
        p = _Links()
        p.feed(r.read().decode("utf-8", "replace"))
    return p.links


def expand(src: dict) -> list[dict]:
    """Turn directory-style sources (5 m site DEMs) into concrete file entries."""
    if src.get("kind") != "pgda-5m-sites":
        return [src]
    out = []
    for site in src["sites"]:
        base = src["url"].rstrip("/") + f"/{site}/"
        try:
            links = list_dir(base)
        except Exception as e:  # pragma: no cover - network
            print(f"  cannot list {base}: {e}", file=sys.stderr)
            continue
        for suffix in ("_surf.tif", "_toterr.tif"):
            names = sorted({l.split("/")[-1] for l in links if l.lower().endswith(suffix) and "clone" not in l.lower()})
            if not names:
                print(f"  {site}: no *{suffix} found", file=sys.stderr)
                continue
            name = names[0]
            out.append({**src, "kind": "file", "id": f"site5m-{site}-{suffix[1:-4]}", "url": base + name,
                        "dest": f"{src['dest'].rstrip('/')}/{site}/{name}", "site": site})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", type=int, default=int(os.environ.get("DATA_TIER", "1")))
    ap.add_argument("--only", nargs="*", help="source ids (prefix match)")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    sources = json.loads(SOURCES.read_text())["sources"]
    todo = [s for s in sources if s["tier"] <= a.tier and (not a.only or any(s["id"].startswith(o) for o in a.only))]
    man = load_manifest()
    for src in todo:
        for f in expand(src):
            if a.list:
                print(f["id"], f["url"])
                continue
            print(f"[{f['id']}] {f['url']}")
            dest = RAW / f["dest"]
            size, digest = fetch(f["url"], dest, f.get("size"), f.get("sha256"))
            man = load_manifest()  # re-read: several downloader processes may run in parallel
            man["files"][f["id"]] = {
                "url": f["url"], "path": str(dest.relative_to(DATA)), "size": size, "sha256": digest,
                "license": f.get("license", ""), "description": f.get("description", ""),
                "job": "pipeline/jobs/download.py", "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            save_manifest(man)
    print("download: all requested sources present")


if __name__ == "__main__":
    main()
