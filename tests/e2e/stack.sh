#!/usr/bin/env bash
# One-command integration stack (Python API): reset DB -> build http frontend -> start gunicorn -> wait for /readyz.
#   backend/tests/e2e/stack.sh [--no-build] [--no-reset] [--port 8000] [--db seereonos] [--workers 2] [--log FILE]
#   backend/tests/e2e/stack.sh --stop [--port 8000]
# The API serves dist/ (frontend built with `npm run build:http`, production React build) on the same port,
# DEMO_MODE=true (suites use POST /api/v1/demo/reset between runs), TZ=Asia/Kolkata, APP_ENV=development (rows are
# deep-frozen: an illegal in-place mutation fails loudly). Log: backend/var/stack-<port>.log (appended, JSON lines with
# one "request completed" entry per request at LOG_LEVEL=info); PID: backend/var/stack-<port>.pid.
# Several ports may share one DB (multi-instance tests): start the second one with --no-build --no-reset --port 8001.
# Env: STACK_DB (default db), STACK_STATIC (built frontend, default frontend/dist), LOG_LEVEL (info), RATE_LIMIT_AUTH /
# RATE_LIMIT_GLOBAL (high defaults: suites log in hundreds of times), WEB_CONCURRENCY (= --workers).
set -euo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$(pwd)
PORT=8000 DB=${STACK_DB:-seereonos} BUILD=1 RESET=1 STOP=0 LOG="" WORKERS=${WEB_CONCURRENCY:-2}
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --no-reset) RESET=0 ;;
    --stop) STOP=1 ;;
    --port) PORT="$2"; shift ;;
    --db) DB="$2"; shift ;;
    --workers) WORKERS="$2"; shift ;;
    --log) LOG="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
mkdir -p backend/var
PIDF="$ROOT/backend/var/stack-$PORT.pid"
LOG="${LOG:-$ROOT/backend/var/stack-$PORT.log}"
stop() {
  if [ -f "$PIDF" ]; then
    local pid; pid=$(cat "$PIDF")
    kill -TERM "$pid" 2>/dev/null || true   # gunicorn: graceful (finishes in-flight requests)
    for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$pid" 2>/dev/null || true
    rm -f "$PIDF"
  fi
}
stop
[ "$STOP" = 1 ] && { echo "stopped :$PORT"; exit 0; }

# PostgreSQL up?
pg_isready -q -h localhost -p 5432 || { pg_ctlcluster 16 main start 2>/dev/null || true; sleep 2; }

export DATABASE_URL="postgres://seereon_owner:seereon_owner@localhost:5432/$DB"
export DATABASE_APP_URL="postgres://seereon_app:seereon_app@localhost:5432/$DB"
export TZ=Asia/Kolkata DEMO_MODE=true APP_ENV=development STATIC_DIR="${STACK_STATIC:-$ROOT/frontend/dist}"
export LOG_LEVEL="${LOG_LEVEL:-info}" RATE_LIMIT_AUTH="${RATE_LIMIT_AUTH:-1000}" RATE_LIMIT_GLOBAL="${RATE_LIMIT_GLOBAL:-100000}"

if [ "$RESET" = 1 ]; then echo "[stack] python -m app.db.reset ($DB)"; (cd backend && python3 -m app.db.reset >/dev/null); fi
if [ "$BUILD" = 1 ]; then
  # always a production React build, whatever NODE_ENV the caller has
  echo "[stack] build http frontend"; (cd frontend && NODE_ENV=production npm run -s build:http >/dev/null)
fi
echo "[stack] start API on :$PORT, $WORKERS workers (log $LOG)"
cd backend
setsid nohup python3 -m gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w "$WORKERS" -b "0.0.0.0:$PORT" \
  --graceful-timeout 20 --timeout 120 --keep-alive 75 --pid "$PIDF" >>"$LOG" 2>&1 </dev/null &
cd "$ROOT"
for _ in $(seq 1 200); do
  if curl -sf "http://localhost:$PORT/readyz" >/dev/null; then echo "[stack] ready :$PORT pid $(cat "$PIDF")"; exit 0; fi
  sleep 0.2
done
echo "[stack] /readyz timeout" >&2; tail -30 "$LOG" >&2; exit 1
