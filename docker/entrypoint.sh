#!/bin/sh
# Applies pending migrations (checksummed, idempotent; compatible with the Node runner's schema_migrations), optionally
# seeds demo data into an EMPTY database, then execs the given command (gunicorn by default) so SIGTERM reaches it.
set -e
if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  python -m app.db.migrate
fi
if [ "${SEED_DEMO:-false}" = "true" ]; then
  # refuses (non-zero) when tenants already exist; that is expected after the first start
  python -m app.db.reset --seed || echo "seed skipped (database not empty)"
fi
exec "$@"
