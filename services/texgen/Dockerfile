# Optional, disabled texture-generation stub (compose profile "ai"). Build context = project root:
#   docker build -f services/texgen/Dockerfile -t lunar-texgen .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY services/texgen/requirements.txt /srv/requirements.txt
RUN pip install -r /srv/requirements.txt
COPY services/texgen/app /srv/app
RUN useradd --create-home --uid 10001 app
USER app
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
