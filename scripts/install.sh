#!/usr/bin/env sh
# NexPanel installer for Linux
# Usage: sh scripts/install.sh
# Safe to run repeatedly — it will not destroy an existing installation.
set -eu

echo "== NexPanel installer (Linux) =="

# --- Environment detection -------------------------------------------------
ARCH=$(uname -m)
RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
RAM_GB=$((RAM_KB / 1048576))
DISK_GB=$(df -Pk . | awk 'NR==2 {print int($4/1048576)}')
echo "Arch: $ARCH  RAM: ${RAM_GB}GB  Free disk: ${DISK_GB}GB"
[ "$RAM_GB" -lt 2 ] && echo "WARNING: less than 2GB RAM." || true
[ "$DISK_GB" -lt 5 ] && echo "WARNING: less than 5GB free disk." || true

# --- Dependencies ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 20+ is required. Install it (e.g. via https://github.com/nodesource/distributions) and re-run." >&2
  exit 1
fi
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found $(node --version))." >&2
  exit 1
fi
echo "Node.js $(node --version) found."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm@10
fi

command -v java >/dev/null 2>&1 || echo "WARNING: Java not found — required for Minecraft servers (install a JDK 21)."
command -v git  >/dev/null 2>&1 || echo "WARNING: Git not found — required for git-based deployments."
command -v docker >/dev/null 2>&1 && echo "Docker detected." || echo "Docker not found (optional)."

# --- Install ---------------------------------------------------------------
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"
echo "Installing dependencies..."
pnpm install
echo "Building..."
pnpm -r --workspace-concurrency=1 build
echo "Initializing database..."
node apps/cli/dist/index.js install

echo ""
echo "== Installation complete =="
echo "Start the panel:   node apps/cli/dist/index.js start"
echo "Then open:         http://localhost:3000"
echo "Tip: ln -s $REPO_ROOT/apps/cli/dist/index.js /usr/local/bin/nexpanel"
