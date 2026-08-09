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
"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)' \
  || fail "Python 3 is required but '$PYTHON_BIN' is not Python 3"

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
