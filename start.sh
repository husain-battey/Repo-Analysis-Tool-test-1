#!/usr/bin/env bash
# Start RAT: FastAPI backend on :8000 and the Next.js dashboard on :3000.
#
#   ./start.sh            # dev servers (fast start, hot reload)
#   ./start.sh --prod     # optimized Next.js build, then serve it
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
API_PORT="${API_PORT:-8000}"
UI_PORT="${UI_PORT:-3000}"
PROD=0
[[ "${1:-}" == "--prod" ]] && PROD=1

echo "==> checking python environment"
if [[ ! -x .venv/bin/uvicorn ]]; then
  "$PY" -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
fi
.venv/bin/pip install --quiet -r backend/requirements.txt

echo "==> checking node environment"
command -v npm >/dev/null || { echo "npm is required (Node 18+)"; exit 1; }
[[ -d frontend/node_modules ]] || (cd frontend && npm install --no-audit --no-fund)

echo "==> starting backend on http://127.0.0.1:${API_PORT}"
.venv/bin/uvicorn app.main:app --app-dir backend \
  --host 0.0.0.0 --port "$API_PORT" &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${API_PORT}/api/health" >/dev/null; then break; fi
  sleep 0.5
done
echo "    backend: $(curl -sf "http://127.0.0.1:${API_PORT}/api/health" || echo 'not responding')"

echo "==> starting dashboard on http://127.0.0.1:${UI_PORT}"
cd frontend
export RAT_API_URL="http://127.0.0.1:${API_PORT}"
if [[ "$PROD" == 1 ]]; then
  npm run build
  npm run start -- -p "$UI_PORT"
else
  npm run dev -- -p "$UI_PORT"
fi
