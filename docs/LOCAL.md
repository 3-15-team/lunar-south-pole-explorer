# Complete local operation

From the repository root, with Docker Desktop (Linux containers) or Docker Engine
and Compose v2.20+ running:

```text
docker compose up --build --wait --wait-timeout 3600
```

Open <http://localhost:8642>. This is the complete startup command, including data
acquisition and generation. No host Node, Python, Make, Bash, Just, cloud CLI, or
cloud credentials are needed. The first run needs internet, several GB of free
disk, and time to download NASA data and generate products. Follow progress from
another terminal with `docker compose logs --follow data-init`.

The initializer downloads real NAIF/LOLA sources, creates ephemerides, DEM tiles,
sites, PSRs, panorama micro-relief, the outer Moon context, regional horizon maps
and prebuilt heatmaps. It then validates the generated product checksums. Compute
and web services start only after successful initialization. A failed download or
job fails startup; rerun the same command to resume. Synthetic terrain is never
substituted for missing NASA data.

The default is tier 0: 80 m polar terrain, no 5 m site DEMs or terrain-error maps,
and a **1920 m** regional overview grid. All API operations are available, but
these lower-resolution products are not equivalent to the full scientific tier.
The browser still calculates terrain/suitability at the available DEM resolution.
Terrain-error uncertainty requires tier 1. For higher resolution, put these values
in an optional root `.env` before running the same command:

```dotenv
DATA_TIER=1
REGION_RES=240
SCIENCE_THREADS=4
```

Tier 1 downloads 40 m global terrain, error maps and 5 m site DEMs; it requires
substantially more disk, memory and computation. A 240 m region build can take a
long time. Configure Docker resources accordingly. Changing data settings requires
rerunning startup; avoid regenerating data while interacting with the application.

The `lunar-data` named volume stores raw downloads, generated products, caches and
the bootstrap record. `docker compose down` preserves it. After successful setup,
the stack can restart with `docker compose up --wait` without NASA or cloud access.
Offline restart requires the built images and volume to remain present; a fresh
machine needs these transferred or an initial online setup. Do not use `down -v`
unless you intend to delete all downloaded and generated data.

To enforce offline container networking after bootstrap, stop the normal stack,
then run `just compose-offline` or this direct equivalent:

```text
docker compose -f compose.yaml -f infra/offline.compose.yaml up --wait --wait-timeout 300
```

This optional override requires Compose 2.24+ for its port reset. The internal
Docker network permits web/API communication but gives application/data-processing
containers no external route. A small ingress-only proxy exposes localhost on
Docker Desktop, using the already-built web image. It has a host-facing network,
but only forwards requests to the local web service; it does not acquire data.
Use `just compose-offline-smoke` to check this mode through its ingress proxy.
When switching back, stop the offline stack with `just compose-offline-down`
(or `docker compose -f compose.yaml -f infra/offline.compose.yaml down`). Missing/corrupt data fails
initialization rather than contacting NASA successfully through this network.

The port binds to localhost only. To use another port, add `COMPOSE_PORT=8643` to
`.env`. Panorama runtime options are also supported there: `PANO_TERRAIN_INTERP`,
`PANO_RELIEF_AA`, `PANO_MICRO`, and `PANO_MICRO_DEFAULT`.

## Verification and scientific tools

```text
docker compose --profile tools run --build --rm science python tools/project.py lint
docker compose --profile tools run --build --rm science
docker compose --profile tools run --build --rm web-check
docker compose --profile tools run --build --rm smoke
```

The Python and frontend checks use the same generated data when available.
Without it, tests explicitly requiring data skip; synthetic tests and shared
Python/TypeScript golden-vector tests still run. The smoke service starts its
dependencies if necessary and tests real HTTP responses, binary terrain, site
metrics, heatmaps including result retrieval, and robustness.

Run individual existing pipeline jobs without installing Python on the host:

```text
docker compose --profile tools run --rm science python -m pipeline.jobs.status
docker compose --profile tools run --rm science python -m pipeline.jobs.validate_horizons
docker compose --profile tools run --rm science python -m pipeline.jobs.validate_reference
```

Validation reports written inside an ephemeral tools container can be copied out
using a bind mount or `docker compose cp` before removing that container. They do
not automatically modify this checkout.

There is no cloud-provider dependency or new storage-service requirement in this
increment. Existing file contracts are shared through a Docker volume; future
object storage work can preserve those contracts separately.

## Just interface

With Just 1.59+ installed, `just compose-up` runs the exact startup command above.
`just compose-check` runs lint, Python tests, frontend tests/typecheck/build;
`just compose-smoke` checks real HTTP data and API operations. `just compose-down`,
`just compose-status`, `just compose-logs`, `just compose-bootstrap`, and
`just compose-data-status` expose the remaining common Compose operations.
These recipes need only Just and Docker; native setup is not a dependency.

See [verification evidence](./LOCAL_VERIFICATION.md) for the tested environment,
clean-volume generation, scientific/API checks, and offline restart results.

The native recipes (`just setup`, `just setup-py`, `just data-min`, `just dev`)
are a separate optional workflow. They use Node 22 and uv-managed Python 3.12,
with a host dataset under `data/`. `just data <job>` invokes individual jobs;
`just dist` exports a host-built static bundle using portable filesystem code.
