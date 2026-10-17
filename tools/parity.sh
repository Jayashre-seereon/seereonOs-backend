#!/usr/bin/env bash
# Parity of the Python API with the reference (the in-process TypeScript mock), over HTTP:
# fresh DB (python -m app.db.reset) -> Python API on a port (DEMO_MODE) -> backend/tests/e2e/parity.ts (bundled).
#
#   backend/tools/parity.sh [--modules notifications,billing] [--sweep] [--port 8170] [--db seereonos_py_parity]
#                           [--keep] [--no-reset] [--workers 1]
#
#   --modules   only calls whose TS route module (OpenAPI tag) is listed (PARITY_MODULES); default: all
#   --sweep     also every GET route x 6 users (SWEEP=1)
#   --keep      leave the API running afterwards (log: backend/var/parity-<port>.log)
# The database must exist (once, as a superuser):
#   psql -U postgres -v dbname=seereonos_py_parity -f backend/tools/bootstrap.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
PORT=8170 DB=seereonos_py_parity MODULES="" SWEEP="" KEEP=0 RESET=1 WORKERS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --modules) MODULES="$2"; shift ;;
    --sweep) SWEEP=1 ;;
    --port) PORT="$2"; shift ;;
    --db) DB="$2"; shift ;;
    --keep) KEEP=1 ;;
    --no-reset) RESET=0 ;;
    --workers) WORKERS="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
export TZ=Asia/Kolkata
export DATABASE_URL="postgres://seereon_owner:seereon_owner@localhost:5432/$DB"
export DATABASE_APP_URL="postgres://seereon_app:seereon_app@localhost:5432/$DB"
pg_isready -q -h localhost -p 5432 || { pg_ctlcluster 16 main start 2>/dev/null || true; sleep 2; }
psql "$DATABASE_URL" -Atc 'select 1' >/dev/null 2>&1 || { echo "database $DB missing: psql -U postgres -v dbname=$DB -f backend/tools/bootstrap.sql" >&2; exit 2; }
mkdir -p backend/var
LOG="backend/var/parity-$PORT.log"
if [ "$RESET" = 1 ]; then (cd backend && python3 -m app.db.reset >/dev/null); fi

# the API
PIDF="$ROOT/backend/var/parity-$PORT.pid"
if [ -f "$PIDF" ]; then kill "$(cat "$PIDF")" 2>/dev/null || true; rm -f "$PIDF"; sleep 0.5; fi
cd backend
DEMO_MODE=true APP_ENV=development LOG_LEVEL=warn STATIC_DIR=../frontend/dist RATE_LIMIT_AUTH=100000 RATE_LIMIT_GLOBAL=1000000 \
  setsid nohup python3 -m gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w "$WORKERS" -b "127.0.0.1:$PORT" --graceful-timeout 5 >>"$ROOT/$LOG" 2>&1 </dev/null &
echo $! >"$PIDF"
cd "$ROOT"
for _ in $(seq 1 150); do curl -sf "http://localhost:$PORT/readyz" >/dev/null && break; sleep 0.2; done
curl -sf "http://localhost:$PORT/readyz" >/dev/null || { echo "API did not start" >&2; tail -30 "$LOG" >&2; exit 1; }

# the harness (the in-process mock is the reference)
OUT=$(mktemp -d)/parity.cjs
node -e "
const { build } = require('esbuild'); const path = require('path');
build({ entryPoints: ['backend/tests/e2e/parity.ts'], outfile: '$OUT', bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
  alias: { '@': path.join('$ROOT', 'frontend/src') }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, nodePaths: [path.join('$ROOT', 'frontend/node_modules')],
  define: { 'import.meta.env': JSON.stringify({ VITE_API_MODE: 'mock', MODE: 'test', DEV: false, PROD: true }) }, }).catch((e) => { console.error(e); process.exit(1) })"
set +e
API_URL="http://localhost:$PORT" PARITY_MODULES="$MODULES" SWEEP="$SWEEP" NODE_PATH="$ROOT/frontend/node_modules" node "$OUT"
RC=$?
set -e
if [ "$KEEP" = 0 ]; then kill "$(cat "$PIDF")" 2>/dev/null || true; rm -f "$PIDF"; fi
exit $RC
