#!/usr/bin/env bash
# Runs an existing in-process API suite (scratchpad smokeB/smokeC/t2/…, written against '@/mock/server') over HTTP
# against a running Python API: backend/tests/e2e/build-http.mjs swaps '@/mock/server' for the HTTP shim (the shim calls
# POST /demo/reset first and reads PostgreSQL through backend/tests/e2e/dbdump.py for getDb()).
#
#   backend/tools/run_suite.sh <suite.ts> [api_url=http://localhost:8000] [db=seereonos] [suite args...]
#
# The API must run with DEMO_MODE=true on that database (backend/tests/e2e/stack.sh, or parity.sh --keep).
set -euo pipefail
cd "$(dirname "$0")/../.."
SUITE="$1"; API="${2:-http://localhost:8000}"; DB="${3:-seereonos}"
shift $(( $# < 3 ? $# : 3 ))
OUT=$(mktemp -d)/suite.cjs
node backend/tests/e2e/build-http.mjs "$SUITE" "$OUT"
TZ=Asia/Kolkata API_URL="$API" DATABASE_URL="postgres://seereon_owner:seereon_owner@localhost:5432/$DB" NODE_PATH="$(pwd)/frontend/node_modules" node "$OUT" "$@"
