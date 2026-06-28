#!/usr/bin/env bash
# Register a GitHub Actions self-hosted runner on this Mac (Mac mini).
#
# Usage:
#   scripts/setup-runner.sh
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#   - Run from the repo root on the Mac mini

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="Obsidianrokr/ai-summary-chrome-extension"
RUNNER_VERSION="2.323.0"
RUNNER_DIR="${HOME}/actions-runners/ai-summary-chrome-extension"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) RUNNER_ARCH="arm64" ;;
  x86_64) RUNNER_ARCH="x64" ;;
  *)
    echo "Unsupported architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

echo "==> Fetching registration token for ${REPO}..."
TOKEN="$(gh api --method POST "repos/${REPO}/actions/runners/registration-token" --jq .token)"

mkdir -p "$(dirname "$RUNNER_DIR")"

if [[ ! -d "${RUNNER_DIR}" ]]; then
  echo "==> Downloading actions runner v${RUNNER_VERSION} (${RUNNER_ARCH})..."
  curl -fsSL \
    -o "/tmp/actions-runner-osx-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
  mkdir -p "${RUNNER_DIR}"
  tar xzf "/tmp/actions-runner-osx-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz" -C "${RUNNER_DIR}"
fi

cd "${RUNNER_DIR}"

if [[ ! -f .runner ]]; then
  echo "==> Configuring runner..."
  ./config.sh \
    --url "https://github.com/${REPO}" \
    --token "${TOKEN}" \
    --name "mac-mini" \
    --labels "self-hosted,macOS,mac-mini" \
    --work "${RUNNER_DIR}/_work" \
    --unattended \
    --replace
else
  echo "Runner already configured in ${RUNNER_DIR}"
fi

echo ""
echo "Runner ready in ${RUNNER_DIR}"
echo ""
echo "Start interactively:"
echo "  cd ${RUNNER_DIR} && ./run.sh"
echo ""
echo "Or install as a service (starts on login):"
echo "  cd ${RUNNER_DIR} && sudo ./svc.sh install && sudo ./svc.sh start"
echo ""
echo "Then deploy from GitHub:"
echo "  Actions → Deploy to MacBook → Run workflow"
