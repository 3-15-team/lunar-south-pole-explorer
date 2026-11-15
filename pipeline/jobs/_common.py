"""Shared helpers for pipeline jobs: paths, logging, manifest product records."""

from __future__ import annotations

import hashlib
import json
import os
import time
from contextlib import contextmanager
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:
    import fcntl

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data")).resolve()
RAW = DATA / "raw"
WORK = DATA / "work"
WEB = DATA / "web"
MANIFEST = DATA / "manifest.json"
CONFIG = ROOT / "pipeline" / "config"
DOCS = ROOT / "docs"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(job: str, msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {job}: {msg}", flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def write_json(path: Path, obj, indent: int | None = 1) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=indent, ensure_ascii=False) + "\n")
    tmp.replace(path)


@contextmanager
def _manifest_lock():
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST.with_name("manifest.lock"), "a+b") as lf:
        if os.name == "nt":
            if lf.seek(0, 2) == 0:
                lf.write(b"\0")
                lf.flush()
            lf.seek(0)
            msvcrt.locking(lf.fileno(), msvcrt.LK_LOCK, 1)
        else:
            fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lf.seek(0)
                msvcrt.locking(lf.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lf, fcntl.LOCK_UN)


def _rel(path: Path) -> str:
    return Path(path).resolve().relative_to(DATA).as_posix()


def write_tree_listing(directory: Path, pattern: str = "**/*") -> Path:
    """Write ``SHA256SUMS`` (``<sha256>  <relpath>`` per file) for a product directory."""
    directory = Path(directory)
    lines = []
    for p in sorted(directory.glob(pattern)):
        if p.is_file() and p.name != "SHA256SUMS" and not p.name.endswith(".tmp"):
            lines.append(f"{sha256_file(p)}  {p.relative_to(directory).as_posix()}")
    out = directory / "SHA256SUMS"
    out.write_text("\n".join(lines) + "\n")
    return out


def record_product(name: str, path: Path, job: str, **extra) -> dict:
    """Record a produced file (or a tree via its SHA256SUMS listing) in data/manifest.json -> products."""
    path = Path(path)
    entry = {"path": _rel(path), "sha256": sha256_file(path), "job": job, "size": path.stat().st_size,
             "generated": now_iso(), **extra}
    with _manifest_lock():
        man = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"version": 1, "files": {}}
        man.setdefault("products", {})[name] = entry
        tmp = MANIFEST.with_suffix(".tmp")
        tmp.write_text(json.dumps(man, indent=1, sort_keys=True))
        tmp.replace(MANIFEST)
    return entry


def record_tree(name: str, directory: Path, job: str, pattern: str = "**/*", **extra) -> dict:
    listing = write_tree_listing(directory, pattern)
    n = sum(1 for _ in listing.read_text().splitlines() if _)
    total = sum(p.stat().st_size for p in Path(directory).glob(pattern) if p.is_file())
    return record_product(name, listing, job, kind="tree", files=n, bytes=total, **extra)
