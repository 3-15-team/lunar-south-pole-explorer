# Compute service image. Build context = project root (needs libs/lunarcore):
#   docker build -f services/compute/Dockerfile -t lunar-compute .
#   docker run -p 8000:8000 -v "$PWD/data:/data" lunar-compute
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/data \
    NUMBA_CACHE_DIR=/tmp/numba-cache

WORKDIR /srv
COPY services/compute/requirements.txt /srv/requirements.txt
RUN pip install -r /srv/requirements.txt
COPY libs/lunarcore /srv/libs/lunarcore
RUN pip install /srv/libs/lunarcore
COPY services/compute/app /srv/app

RUN useradd --create-home --uid 10001 app && mkdir -p /tmp/numba-cache /tmp/compute-cache \
    && chown app /tmp/numba-cache /tmp/compute-cache
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
