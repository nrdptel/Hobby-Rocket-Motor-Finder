#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Installs everything needed to lint, test, build, and run the e2e suite for
# this repo. There is no local dev server in the web flow: work happens on
# branches/PRs that are tested here or in CI, and visual checks are done on
# Vercel — so this hook targets the test/lint/build toolchain, not `next dev`.
#
# Notes:
#   - The container's default `python3` is 3.11, but the project requires
#     3.12+, so we explicitly build the backend venv with python3.12.
#   - Idempotent: safe to re-run. Reuses the venv / node_modules when present.
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Backend: Python 3.12 venv + editable install with dev extras ----------
PY=python3.12
command -v "$PY" >/dev/null 2>&1 || PY=/usr/bin/python3.12
VENV="$PROJECT_DIR/backend/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "[session-start] creating backend venv with $($PY --version)"
  "$PY" -m venv "$VENV"
fi
echo "[session-start] installing backend (editable, with dev extras)"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -e "$PROJECT_DIR/backend[dev]"

# --- Frontend: npm deps -----------------------------------------------------
# Use `npm ci` (not `npm install`): it installs strictly from the lockfile and
# never rewrites it, so the web container's npm doesn't churn package-lock.json
# on every session. Matches CI.
echo "[session-start] installing frontend npm deps"
( cd "$PROJECT_DIR/frontend" && npm ci --no-fund --no-audit )

# --- Playwright browser for the e2e suite ----------------------------------
echo "[session-start] installing Playwright Chromium"
( cd "$PROJECT_DIR/frontend" && npx --yes playwright install --with-deps chromium )

# --- Persist the backend venv onto PATH for the session --------------------
# So `hpr`, `pytest`, and `ruff` work without manually activating the venv.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export VIRTUAL_ENV=\"$VENV\""
    echo "export PATH=\"$VENV/bin:\$PATH\""
  } >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] done"
