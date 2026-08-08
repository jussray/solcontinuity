#!/usr/bin/env bash
# One-command environment setup for SolContinuity.
# Usage:
#   ./setup.sh
#   curl -fsSL <raw-url-to-this-file> | bash
set -euo pipefail

log() { printf '\n==> %s\n' "$1"; }
fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

REPO_URL="https://github.com/jussray/solcontinuity"

if [ ! -f "package.json" ] || ! grep -qE '^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"solcontinuity"' package.json 2>/dev/null; then
  log "Cloning SolContinuity"
  command -v git >/dev/null 2>&1 || fail "git is required but not found"
  git clone "$REPO_URL" solcontinuity
  cd solcontinuity
fi

command -v node >/dev/null 2>&1 || fail "Node.js is required but not found (https://nodejs.org)"
command -v npm >/dev/null 2>&1 || fail "npm is required but not found"
PYTHON_BIN="$(command -v python3 || command -v python || true)"
[ -n "$PYTHON_BIN" ] || fail "Python 3 is required but not found"
if ! command -v python >/dev/null 2>&1; then
  log "warning: 'python' not found on PATH (using '$PYTHON_BIN' for this setup). The npm scripts test:python, test:e2e, and start:analytics invoke 'python' directly, so 'npm run verify' will fail until 'python' resolves to a Python 3 interpreter (e.g. install python-is-python3, or add a matching shim to PATH)."
fi

log "Node $(node --version), npm $(npm --version), $($PYTHON_BIN --version)"

log "Installing Node dependencies (npm install)"
npm install

log "Installing Python dependencies (requirements-dev.txt)"
"$PYTHON_BIN" -m pip install -r requirements-dev.txt

log "Installing Playwright Chromium"
if [ "$(uname -s)" = "Linux" ]; then
  "$PYTHON_BIN" -m playwright install --with-deps chromium
else
  "$PYTHON_BIN" -m playwright install chromium
fi

log "Setup complete"
cat <<'EOF'

Next steps:
  npm run verify        # typecheck, tests, e2e, clean-room consumer gate
  npm run start:analytics   (terminal 1)
  npm start                 (terminal 2, requires SOLCONTINUITY_ANALYTICS_URL)

See README.md for details.
EOF
