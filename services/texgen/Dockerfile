FROM python:3.12-slim
WORKDIR /srv
RUN pip install --no-cache-dir fastapi==0.115.* uvicorn==0.32.*
COPY services/texgen/app ./app
USER nobody
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
