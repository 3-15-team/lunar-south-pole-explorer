"""Restore processed products from a static mirror instead of recomputing (just data pull).

    DATA_BASE_URL=https://host/path python -m pipeline.jobs.pull [--only dem ephem ...]

For every entry of data/manifest.json -> products: a single file is fetched from
``$DATA_BASE_URL/<path>``; a tree product (``kind: tree``) is described by its SHA256SUMS listing, which is
fetched first, then every listed file. Each file is verified against its sha256; files already present
with the right hash are skipped. Any static host works (cloud-agnostic).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

from ._common import DATA, MANIFEST

UA = "lunar-site-explorer-pipeline/1.0"


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def fetch(base: str, rel: str, sha: str | None) -> bool:
    dest = DATA / rel
    if dest.exists() and sha and _sha(dest) == sha:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(f"{base.rstrip('/')}/{rel}", headers={"User-Agent": UA})
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as f:
        for b in iter(lambda: r.read(1 << 20), b""):
            f.write(b)
    if sha and _sha(tmp) != sha:
        tmp.unlink()
        raise SystemExit(f"sha256 mismatch for {rel}")
    tmp.replace(dest)
    return True


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", nargs="*", help="product names (see data/manifest.json -> products)")
    a = ap.parse_args(argv)
    base = os.environ.get("DATA_BASE_URL", "").strip()
    if not base:
        sys.exit("DATA_BASE_URL is not set. Point it at a static copy of the data/ directory, e.g.\n"
                 "  set DATA_BASE_URL in .env, then run: just data pull\n"
                 "or rebuild locally with: just data-min")
    man = json.loads(MANIFEST.read_text())
    prods = man.get("products", {})
    if not prods:
        sys.exit("data/manifest.json lists no products")
    got = skipped = 0
    for name, e in sorted(prods.items()):
        if a.only and name not in a.only:
            continue
        if e.get("kind") == "tree":
            fetch(base, e["path"], e["sha256"])
            listing = DATA / e["path"]
            root = Path(e["path"]).parent
            for line in listing.read_text().splitlines():
                if not line.strip():
                    continue
                sha, rel = line.split(None, 1)
                if fetch(base, (root / rel.strip()).as_posix(), sha):
                    got += 1
                else:
                    skipped += 1
        else:
            if fetch(base, e["path"], e["sha256"]):
                got += 1
            else:
                skipped += 1
        print(f"  {name}: ok")
    print(f"pull: {got} files downloaded, {skipped} already present")


if __name__ == "__main__":
    main()
