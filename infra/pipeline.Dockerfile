# Data pipeline toolchain (pipeline/requirements.txt) for machines without a local Python setup.
# Code is NOT baked in: `make bootstrap` / `make data-docker` mount the repo read-only at /repo and
# ./data read-write at /repo/data, so pipeline changes need no image rebuild.
#   docker build -f infra/pipeline.Dockerfile -t lunar-explorer-pipeline .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/repo:/repo/libs/lunarcore \
    DATA_DIR=/repo/data \
    NUMBA_CACHE_DIR=/repo/data/work/numba-cache \
    HOME=/tmp

# rasterio's manylinux wheel bundles GDAL but links the system expat (absent from -slim)
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*
COPY pipeline/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt certifi \
    && python -c "import rasterio, numba, spiceypy, shapely, shapefile, scipy, PIL; print('pipeline deps ok')"
WORKDIR /repo
