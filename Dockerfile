# syntax=docker/dockerfile:1.7
# SeereonOS: one image = Python API (FastAPI on gunicorn/uvicorn workers) + the built frontend (dist/, SPA fallback)
# + migrations and the demo seed. Build from the REPOSITORY ROOT:  docker build -f backend/Dockerfile -t seereonos .
# (docker compose up --build at the repository root does that). The runtime image contains no Node.js.

# ---- node stage: frontend in http mode, demo seed + catalogue check ----
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY backend/ /app/backend/
ENV TZ=Asia/Kolkata
RUN npx vite build --mode http \
 && node /app/backend/tools/export_catalog.mjs --check \
 && node /app/backend/tools/export_seed.mjs /app/out/seed.json

# ---- python dependencies ----
FROM python:3.11-slim AS pydeps
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r /tmp/requirements.txt

# ---- runtime ----
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin seereon
ENV APP_ENV=production \
    TZ=Asia/Kolkata \
    PORT=8000 \
    WEB_CONCURRENCY=2 \
    GRACEFUL_TIMEOUT=20 \
    STATIC_DIR=/app/frontend/dist \
    SEED_JSON=/app/var/seed.json \
    MIGRATIONS_DIR=/app/backend/migrations \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --from=pydeps /install /usr/local
WORKDIR /app/backend
COPY --chown=root:root backend/app ./app
COPY --chown=root:root backend/migrations ./migrations
COPY --chown=root:root backend/gunicorn.conf.py ./gunicorn.conf.py
COPY --chown=root:root backend/docker/entrypoint.sh /usr/local/bin/seereonos-entrypoint
COPY --from=web --chown=root:root /app/frontend/dist /app/frontend/dist
COPY --from=web --chown=root:root /app/out/seed.json /app/var/seed.json
RUN chmod 0755 /usr/local/bin/seereonos-entrypoint && python -m compileall -q app
# files are root-owned and read-only for the app user
USER seereon
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/readyz' % os.environ.get('PORT', '8000'), timeout=2)" || exit 1
ENTRYPOINT ["seereonos-entrypoint"]
# workers, timeouts, keep-alive, recycling: gunicorn.conf.py (environment variables, PERFORMANCE.md "Tuning knobs")
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
