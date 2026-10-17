# Backend-only image. Build context is the backend repository root:
#   docker build -t seereonos-api .
# This Dockerfile also works with `docker build -f backend/Dockerfile backend` from the monorepo.

FROM python:3.11-slim AS pydeps
WORKDIR /build
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin seereon
ENV APP_ENV=production \
    TZ=Asia/Kolkata \
    PORT=8000 \
    WEB_CONCURRENCY=2 \
    GRACEFUL_TIMEOUT=20 \
    STATIC_DIR="" \
    MIGRATIONS_DIR=/app/migrations \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --from=pydeps /install /usr/local
WORKDIR /app
COPY --chown=root:root app ./app
COPY --chown=root:root migrations ./migrations
COPY --chown=root:root gunicorn.conf.py ./gunicorn.conf.py
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/seereonos-entrypoint
RUN chmod 0755 /usr/local/bin/seereonos-entrypoint && python -m compileall -q app
USER seereon
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/readyz' % os.environ.get('PORT', '8000'), timeout=2)" || exit 1
ENTRYPOINT ["seereonos-entrypoint"]
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
