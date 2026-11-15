"""Portable project tasks. Uses the active Python interpreter; never invokes Make/Bash."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data")).resolve()


def run(*args: str, cwd: Path = ROOT) -> None:
    print("+ " + " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def smoke(base: str, analysis: bool = False) -> None:
    def fetch(path: str, payload: dict | None = None):
        req = urllib.request.Request(base.rstrip("/") + path)
        if payload is not None:
            req.data = json.dumps(payload).encode()
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=300) as response:
            if response.status != 200:
                raise RuntimeError(f"{path}: HTTP {response.status}")
            body = response.read()
        print(f"ok {path} ({len(body)} bytes)", flush=True)
        return body

    if b"Lunar South Pole" not in fetch("/"):
        raise RuntimeError("Unexpected application HTML")
    for path in ("/data/ephem/index.json", "/data/dem/index.json", "/data/sites.json",
                 "/data/psr.geojson", "/data/micro/index.json", "/data/outer/index.json",
                 "/data/heatmaps/index.json", "/health", "/api/v1/info"):
        result = json.loads(fetch(path))
        if path == "/api/v1/info" and not all(result["capabilities"].values()):
            raise RuntimeError(f"Missing compute capability: {result['capabilities']}")
    tile = fetch("/data/dem/0/0/0.bin")
    if gzip.decompress(tile)[:4] != b"LDT1":
        raise RuntimeError("Invalid DEM payload")
    if analysis:
        interval = {"t0": "2026-12-01T00:00:00Z", "t1": "2026-12-02T00:00:00Z"}
        site = {**interval, "lat": -89.78, "lon": -156.2, "naz": 64, "stepMin": 60}
        json.loads(fetch("/api/v1/site-metrics", site))
        heatmap = json.loads(fetch("/api/v1/heatmap", {**interval, "candidates": 1}))
        for field in ("png", "json", "scoreBin"):
            fetch(heatmap[field])
        json.loads(fetch("/api/v1/robustness", {
            **interval, "candidates": [{"lat": -89.78, "lon": -156.2}], "n": 10, "k": 1,
        }))
    print("Smoke checks passed", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", choices=["test-py", "lint", "smoke", "data", "dist", "doctor", "validate"])
    parser.add_argument("args", nargs="*")
    parser.add_argument("--analysis", action="store_true")
    options = parser.parse_args()
    if options.task == "test-py":
        run(sys.executable, "-m", "pytest", "-q", "libs/lunarcore/tests", "pipeline/tests", "services/compute/tests")
    elif options.task == "lint":
        run(sys.executable, "-m", "ruff", "check", "libs", "pipeline", "services", "tools")
    elif options.task == "smoke":
        smoke(options.args[0] if options.args else "http://localhost:8642", options.analysis)
    elif options.task == "data":
        jobs = {"ephem": "ephemeris", "tiles": "dem_tiles", "horizon": "horizon_maps",
                "heatmaps": "prebake", "micro": "micro_relief", "outer": "outer_dem",
                "sites": "sites", "psr": "psr", "pull": "pull", "status": "status", "fetch": "download"}
        if len(options.args) != 1 or options.args[0] not in jobs:
            parser.error("data requires one of: " + ", ".join(jobs))
        run(sys.executable, "-m", "pipeline.jobs." + jobs[options.args[0]])
    elif options.task == "dist":
        dest = ROOT / "dist-static"
        if not (WEB / "dist" / "index.html").is_file() or not (DATA / "web" / "dem" / "index.json").is_file():
            raise SystemExit("Build the frontend and scientific data before exporting a static bundle")
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(WEB / "dist", dest)
        shutil.copytree(DATA / "web", dest / "data", ignore=shutil.ignore_patterns("*.tmp"))
        print(f"Static bundle: {dest}")
    elif options.task == "validate":
        for job in ("validate_horizons", "validate_reference"):
            run(sys.executable, "-m", f"pipeline.jobs.{job}")
    else:
        print(f"Python: {sys.version}\nData: {DATA}\nDisk free: {shutil.disk_usage(ROOT).free / 1e9:.1f} GB")
        for tool in ("docker", "just", "node", "npm", "uv"):
            print(f"{tool}: {shutil.which(tool) or 'not installed (only needed for its workflow)'}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)
