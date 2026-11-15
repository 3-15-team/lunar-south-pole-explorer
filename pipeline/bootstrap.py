"""Prepare real scientific data automatically; persistent volumes make restarts offline.

Default: tier 0 (80 m polar DEM), 1920 m regional overview. Set DATA_TIER=1 and
REGION_RES=240 for the larger scientific products. No synthetic data fallback.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys

from pipeline.jobs._common import DATA, MANIFEST, ROOT, WEB, WORK, log, sha256_file, write_json

VERSION = 1


def fingerprint(tier: int, region_res: int) -> str:
    h = hashlib.sha256(f"{VERSION}:{tier}:{region_res}".encode())
    for directory in (ROOT / "pipeline", ROOT / "libs" / "lunarcore" / "lunarcore"):
        for p in sorted(directory.rglob("*")):
            if p.is_file() and p.suffix in (".py", ".json"):
                h.update(p.relative_to(ROOT).as_posix().encode())
                h.update(p.read_bytes())
    return h.hexdigest()


def complete() -> bool:
    """Reject missing or corrupt generated products, including individual tiles."""
    if not MANIFEST.exists():
        return False
    try:
        products = json.loads(MANIFEST.read_text())["products"]
        required = {"dem", "ephem", "sites", "psr", "heatmaps", "micro_relief", "outer_dem"}
        if not required <= products.keys():
            return False
        for product in products.values():
            p = DATA / product["path"]
            if not p.is_file() or sha256_file(p) != product["sha256"]:
                return False
            if product.get("kind") == "tree":
                for line in p.read_text().splitlines():
                    digest, rel = line.split(None, 1)
                    tile = p.parent / rel.strip()
                    if not tile.is_file() or sha256_file(tile) != digest:
                        return False
        return (WEB / "ephem" / "index.json").is_file() and (WEB / "dem" / "0/0/0.bin").is_file()
    except (OSError, ValueError, KeyError):
        return False


def run(module: str, *args: str) -> None:
    log("bootstrap", f"running {module} {' '.join(args)}")
    subprocess.run([sys.executable, "-m", module, *args], cwd=ROOT, check=True)


def main() -> None:
    tier = int(os.environ.get("DATA_TIER", "0"))
    region_res = int(os.environ.get("REGION_RES", "1920"))
    if tier not in (0, 1) or region_res <= 0:
        raise SystemExit("DATA_TIER must be 0 or 1; REGION_RES must be a positive integer")
    DATA.mkdir(parents=True, exist_ok=True)
    marker = DATA / ".bootstrap.json"
    stamp = fingerprint(tier, region_res)
    # Only the initializer writes data while runtime services start after it exits.
    try:
        cached = json.loads(marker.read_text()) if marker.exists() else {}
    except (OSError, ValueError):
        cached = {}
    valid = complete() if cached else False
    if cached.get("fingerprint") == stamp and valid:
        log("bootstrap", "verified existing products; no network or generation needed")
        return
    marker.unlink(missing_ok=True)
    # The checked-in manifest pins source hashes, not the presence of local files.
    if not MANIFEST.exists():
        seed = json.loads((ROOT / "data" / "manifest.json").read_text())
        write_json(MANIFEST, {"version": 1, "files": seed.get("files", {})})
    log("bootstrap", f"preparing tier {tier}; region grid {region_res} m. First run downloads NASA data.")
    run("pipeline.jobs.download", "--tier", str(tier))
    repair = bool(cached) and not valid
    for job in ("ephemeris", "dem_tiles", "sites", "psr", "micro_relief", "outer_dem"):
        run(f"pipeline.jobs.{job}", *(["--force"] if repair else []))
    run("pipeline.jobs.horizon_maps", "--res", str(region_res), *(["--force"] if repair else []))
    # DataStore/prebake must select exactly the horizon resolution generated above.
    os.environ["REGION_RES"] = str(region_res)
    run("pipeline.jobs.prebake", *(["--force"] if repair else []))
    if not complete() or not (WORK / f"horizon_{region_res}m.json").is_file():
        raise SystemExit("Bootstrap validation failed; inspect products and rerun to resume")
    write_json(marker, {"fingerprint": stamp, "tier": tier, "regionRes": region_res})
    log("bootstrap", "all products verified; starting application")


if __name__ == "__main__":
    main()
