FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/data
WORKDIR /app
COPY requirements-dev.txt ./
COPY pipeline/requirements.txt pipeline/requirements.txt
COPY services/compute/requirements.txt services/compute/requirements.txt
COPY libs/lunarcore libs/lunarcore
RUN pip install -r requirements-dev.txt -e libs/lunarcore
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*
RUN python -c "import rasterio, shapely, spiceypy"
COPY pipeline pipeline
COPY services services
COPY tools tools
COPY docs docs
COPY data/manifest.json data/manifest.json
COPY ruff.toml ./
CMD ["python", "-m", "pipeline.bootstrap"]
