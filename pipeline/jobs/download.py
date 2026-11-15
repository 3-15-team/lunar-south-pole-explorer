"""Resumable, idempotent downloader for the source datasets in pipeline/sources.json.

Stdlib only so it can run before the virtualenv exists.

    python pipeline/jobs/download.py --tier 1            # everything up to tier 1
    python pipeline/jobs/download.py --only ldem-80s-80m # a single source

Each finished file is recorded in data/manifest.json (url, path, size, sha256,
license). Re-running skips files whose size (and sha256, when pinned) match.

Progress: a plan first (files, total size, already present), then per file
"[i/N] id" with a live bar on a terminal (or a line every 10 s in logs) and the
overall share of the bytes still to download.
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
TTY = sys.stdout.isatty()


def human(n: float | None) -> str:
    if n is None:
        return "?"
    for unit, k in (("GB", 1e9), ("MB", 1e6), ("kB", 1e3)):
        if n >= k:
            return f"{n / k:.1f} {unit}"
    return f"{int(n)} B"


class Progress:
    """Overall byte progress across all files of one run (for the "total" part of the bar)."""

    def __init__(self, total: int | None) -> None:
        self.total = total
        self.done = 0

    def line(self, name: str, done: int, size: int | None, t0: float, start: int) -> str:
        rate = (done - start) / max(1e-3, time.time() - t0)
        if size:
            frac = min(1.0, done / size)
            bar = "#" * int(frac * 24) + "-" * (24 - int(frac * 24))
            eta = (size - done) / rate if rate > 0 else 0
            head = f"  [{bar}] {100 * frac:5.1f}% {human(done)}/{human(size)} {rate / 1e6:5.1f} MB/s ETA {int(eta) // 60}:{int(eta) % 60:02d}"
        else:
            head = f"  {human(done)} {rate / 1e6:5.1f} MB/s"
        tot = f" | all {100 * min(1.0, (self.done + done - start) / self.total):4.1f}%" if self.total else ""
        return head + tot


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


def fetch(url: str, dest: Path, expect_size: int | None, expect_sha: str | None, retries: int = 5,
          prog: Progress | None = None) -> tuple[int, str]:
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
                pr = prog or Progress(None)
                every = 0.25 if TTY else 10.0
                for b in iter(lambda: r.read(CHUNK), b""):
                    f.write(b)
                    done += len(b)
                    if time.time() - last > every:
                        last = time.time()
                        msg = pr.line(dest.name, done, total, t0, have)
                        print(("\r" + msg + "  ") if TTY else msg, end="" if TTY else "\n", flush=True)
                if TTY:
                    print("\r" + pr.line(dest.name, done, total, t0, have) + "  ", flush=True)
                pr.done += done - have
            got = part.stat().st_size
            if size is not None and got != size:
                raise OSError(f"size {got} != expected {size}")
            digest = sha256_of(part)
            if expect_sha and digest != expect_sha:
                part.unlink()
                raise OSError("sha256 mismatch")
            part.replace(dest)
            print(f"  done {dest.relative_to(DATA)} {got/1e6:.1f} MB sha256={digest[:16]}...")
            return got, digest
        except (OSError, urllib.error.URLError, TimeoutError) as e:
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
    """Turn directory-style sources (5 m site DEMs) into concrete file entries.

    Some PGDA site directories have no index page; their files are linked from the
    parent listing, which is used as a fallback. Surfaces come first, error maps after.
    """
    if src.get("kind") != "pgda-5m-sites":
        return [src]
    root = src["url"].rstrip("/") + "/"
    listings: dict[str, list[str]] = {}
    root_links: list[str] | None = None
    out = []
    known = load_manifest()["files"]
    for suffix in ("_surf.tif", "_toterr.tif"):
        for site in src["sites"]:
            base = root + f"{site}/"
            fid = f"site5m-{site}-{suffix[1:-4]}"
            m = known.get(fid)
            if m and (DATA / m["path"]).exists() and (DATA / m["path"]).stat().st_size == m["size"]:
                out.append({**src, "kind": "file", "id": fid, "url": m["url"], "size": m["size"],
                            "dest": str(Path(m["path"]).relative_to("raw")), "site": site})
                continue
            if site not in listings:
                try:
                    listings[site] = list_dir(base)
                except Exception as e:  # pragma: no cover - network
                    print(f"  cannot list {base}: {e}", file=sys.stderr)
                    listings[site] = []
            names = sorted({ln.split("/")[-1] for ln in listings[site]
                            if ln.lower().endswith(suffix) and "clone" not in ln.lower()})
            if not names:
                if root_links is None:
                    try:
                        root_links = list_dir(root)
                    except Exception as e:  # pragma: no cover - network
                        print(f"  cannot list {root}: {e}", file=sys.stderr)
                        root_links = []
                names = sorted({ln.split("/")[-1] for ln in root_links
                                if f"/{site}/" in ln and ln.lower().endswith(suffix) and "clone" not in ln.lower()})
            if not names:
                print(f"  {site}: no *{suffix} found", file=sys.stderr)
                continue
            name = names[0]
            out.append({**src, "kind": "file", "id": f"site5m-{site}-{suffix[1:-4]}", "url": base + name,
                        "dest": f"{src['dest'].rstrip('/')}/{site}/{name}", "site": site})
    return out


def cached_ok(dest: Path, size: int | None) -> bool:
    return dest.exists() and size is not None and dest.stat().st_size == size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", type=int, default=int(os.environ.get("DATA_TIER", "1")))
    ap.add_argument("--only", nargs="*", help="source ids (prefix match)")
    ap.add_argument("--sites", nargs="*", help="only these 5 m sites (expanded entries of pgda-5m-sites)")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    sources = json.loads(SOURCES.read_text())["sources"]
    todo = [s for s in sources if s["tier"] <= a.tier and (not a.only or any(s["id"].startswith(o) for o in a.only))]
    files = [f for src in todo for f in expand(src) if not (a.sites and f.get("site") is not None and f["site"] not in a.sites)]
    if a.list:
        for f in files:
            print(f["id"], f["url"])
        return
    # plan: sizes from sources.json, else HEAD (cheap), so the run shows what it will fetch
    print(f"download: {len(files)} files (tier <= {a.tier}) -> {RAW}", flush=True)
    known = load_manifest()["files"]

    def in_manifest(f: dict) -> bool:
        m = known.get(f["id"])
        return bool(m) and (DATA / m["path"]).exists() and (DATA / m["path"]).stat().st_size == m["size"]

    sizes: list[int | None] = []
    for f in files:
        sizes.append(known[f["id"]]["size"] if in_manifest(f) else (f.get("size") or remote_size(f["url"])))
    present = [cached_ok(RAW / f["dest"], sz) for f, sz in zip(files, sizes)]
    total = sum(sz or 0 for sz in sizes)
    to_get = sum(sz or 0 for sz, ok in zip(sizes, present) if not ok)
    unknown = sum(1 for sz in sizes if sz is None)
    print(f"download: {human(total)} in total, {human(total - to_get)} already present, {human(to_get)} to fetch"
          + (f" (+{unknown} of unknown size)" if unknown else ""), flush=True)
    prog = Progress(to_get or None)
    t_all = time.time()
    for i, (f, sz) in enumerate(zip(files, sizes), 1):
        if in_manifest(f):  # already downloaded and verified: no network, no re-hash
            print(f"[{i}/{len(files)}] {f['id']}  {human(sz)}  ok (in manifest)", flush=True)
            continue
        print(f"[{i}/{len(files)}] {f['id']}  {human(sz)}  {f['url']}", flush=True)
        dest = RAW / f["dest"]
        size, digest = fetch(f["url"], dest, sz, f.get("sha256"), prog=prog)
        man = load_manifest()  # re-read: several downloader processes may run in parallel
        man["files"][f["id"]] = {
            "url": f["url"], "path": str(dest.relative_to(DATA)), "size": size, "sha256": digest,
            "license": f.get("license", ""), "description": f.get("description", ""),
            "job": "pipeline/jobs/download.py", "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        save_manifest(man)
    dt = time.time() - t_all
    print(f"download: all requested sources present ({human(prog.done)} fetched in {int(dt) // 60} min {int(dt) % 60} s)")


if __name__ == "__main__":
    main()
