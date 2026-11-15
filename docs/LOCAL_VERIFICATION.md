# Local runtime verification — 2026-11-15

Verified on native Windows with Docker Desktop Linux containers. Tools used:
Docker 29.9.3, Compose 5.7.0, Just 1.59.0, Python 3.12, Node 22 in containers.
The host frontend also passed under the installed Windows Node runtime.

## Single-command demonstration

```text
docker compose up --build --wait --wait-timeout 3600
```

Started from a new project volume without scientific data. The initializer fetched
real NASA sources, generated ephemerides (2026–2036), 1,241 DEM tiles, 29 catalog
sites, 1,531 PSR polygons, micro-relief, outer terrain, a 208 x 208 x 64 regional
horizon array, features and four prebuilt heatmaps. Startup ended with data-init
exited successfully and both compute and web healthy.

The verified tier is **0: 80 m polar DEM and 1920 m region overview**. Tier 1 and
the much larger 240 m regional build are configurable but were not downloaded or
benchmarked in this verification. Tier 0 does not contain 5 m site DEMs or height
error maps; it must not be interpreted as high-resolution terrain validation.

An existing stack on :8642 was left running. This demonstration uses project
`lunar-compose-check` on <http://localhost:8643>. The ignored local `.env` selects
that project/port so both direct Compose and Just commands address the same stack.
New checkouts default to :8642 and project `lunar-local`.

## Checks performed

- Native Windows `just setup`, `just check`: typecheck/build succeeded; 45 frontend
  tests passed and three data-dependent tests skipped (host data directory empty).
- Native `just setup-py`, `just lint`, `just test-py`, `just api-smoke`: succeeded;
  57 Python tests passed and eight data-dependent tests skipped. A discovered
  background warm-up shutdown issue was fixed before the passing run.
- Native Windows manifest locking, portable object-key generation, Rasterio and
  SPICE imports were exercised using temporary files.
- `just compose-check` against the populated volume: Python lint/tests succeeded;
  all 48 frontend tests passed, including actual-data tests and Python/TypeScript
  golden vectors; typecheck and production build succeeded.
- `just compose-smoke`: real HTML, all required dataset indexes, gzip DEM payload,
  API capabilities, site metrics, heatmap generation and PNG/JSON/score downloads,
  and robustness requests all succeeded over HTTP.
- Browser: map loaded, horizon computation completed, suitability GPU processing
  reached “Horizons ready”, and panorama loaded with micro-relief enabled.

## Persistence and offline checks

Stopped and removed the demonstration containers/network without deleting the
named volume. `just compose-offline` restarted successfully using existing images
and checksummed data, reporting no download/generation needed. The application
network was inspected and confirmed `internal: true`.

Docker Desktop needs a host-facing ingress proxy to expose an internal-only
network to the browser. The offline override provides that proxy using the existing
web image. Scientific/application containers remain on the internal network.
`just compose-offline-smoke` passed through the proxy, including all API analyses.
The browser loaded localhost, produced six canvases and a completed horizon;
its resource timing entries contained no external URLs. This is not a claim that
Docker Desktop or the host OS itself has all internet access disabled.

Finally stopped offline mode and ran `just compose-up` successfully, leaving the
normal stack healthy on :8643 with its persistent data intact.

## Boundaries

First image builds/source acquisition require internet. Air-gapped first install
requires transferring images and the dataset volume beforehand. Cloud-provider
deployment, object storage migration, full-resolution generation and new scientific
algorithms are outside this increment. CI configuration now covers Windows/Linux
native Just and Linux container checks; remote CI has not been run from this session.

Historical pitch/handoff documents can contain obsolete Make commands; current
instructions are [README](../README.md) and [LOCAL](./LOCAL.md). There is no Makefile,
CI Make invocation, or runtime dependency on GNU Make.
