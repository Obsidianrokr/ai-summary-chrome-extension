#!/usr/bin/env bash
# Sync this Chrome extension to a remote Mac over SSH.
#
# Usage:
#   scripts/install-remote.sh [ssh-host] [--open-extensions]
#
# Examples:
#   scripts/install-remote.sh atrium-macbook
#   scripts/install-remote.sh macbook --open-extensions
#
# Requires passwordless SSH (key in ~/.ssh/config). Installs to
# ~/vscode/ai-summary-chrome-extension on the remote machine.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-atrium-macbook}"
OPEN_EXTENSIONS=false

shift || true
for arg in "$@"; do
  case "$arg" in
    --open-extensions) OPEN_EXTENSIONS=true ;;
    *)
      echo "Unknown option: ${arg}" >&2
      exit 1
      ;;
  esac
done

REMOTE_DIR='~/vscode/ai-summary-chrome-extension'

echo "==> Checking SSH to ${HOST}..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'echo ok' >/dev/null 2>&1; then
  echo "Cannot reach ${HOST} over SSH (key auth required)." >&2
  echo "Ensure the MacBook is awake, on the network, and listed in ~/.ssh/config." >&2
  exit 1
fi

echo "==> Ensuring remote directory exists..."
ssh "$HOST" 'mkdir -p ~/vscode'

echo "==> Syncing extension to ${HOST}:${REMOTE_DIR}..."
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'research/' \
  --exclude '.github/' \
  "$ROOT/" "${HOST}:${REMOTE_DIR}/"

echo "==> Running smoke tests on ${HOST} (if Node.js is available)..."
if ssh "$HOST" "command -v node >/dev/null 2>&1"; then
  ssh "$HOST" "cd ${REMOTE_DIR} && \
    node tests/chunker-smoke.test.mjs && \
    node tests/extractor-smoke.test.mjs && \
    node tests/renderer-smoke.test.mjs"
else
  echo "Node.js not found on ${HOST}; skipped remote smoke tests." >&2
fi

if $OPEN_EXTENSIONS; then
  echo "==> Opening Chrome extensions page on ${HOST}..."
  ssh "$HOST" "open -a 'Google Chrome' 'chrome://extensions/' 2>/dev/null || open 'chrome://extensions/'" || true
fi

echo ""
echo "Deployed to ${HOST}:${REMOTE_DIR}"
echo "First time: Chrome → chrome://extensions → Developer mode → Load unpacked"
echo "Updates: click Reload on the extension card (or use --open-extensions)."
