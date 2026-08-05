#!/usr/bin/env sh
# ChickenPanel one-line installer (Linux / macOS)
#
#   curl -fsSL https://raw.githubusercontent.com/ChickenBanana06/ChickenPanel/main/scripts/bootstrap.sh | sh
#
# Clones (or updates) ChickenPanel and builds it. Then start the panel, or
# connect this machine as a node. Safe to re-run.
set -eu

REPO="${CHICKENPANEL_REPO:-ChickenBanana06/ChickenPanel}"
BRANCH="${CHICKENPANEL_BRANCH:-main}"
DIR="${CHICKENPANEL_DIR:-$HOME/chickenpanel}"

echo "== ChickenPanel bootstrap =="
echo "repo: $REPO  branch: $BRANCH  dir: $DIR"

install_node() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "Detected Debian/Ubuntu system. Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    echo "Detected RHEL/CentOS/Fedora system. Installing Node.js 20..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    echo "Detected RHEL/CentOS system. Installing Node.js 20..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    echo "Detected macOS Homebrew. Installing Node.js 20..."
    brew install node@20
    brew link node@20
  else
    echo "ERROR: Node.js 20+ is required, but we couldn't detect a package manager to install it automatically." >&2
    echo "Please install Node.js 20+ manually and re-run this script." >&2
    exit 1
  fi
}

if ! command -v node >/dev/null 2>&1; then
  install_node
fi
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js version is less than 20 (found $(node --version)). Upgrading to Node.js 20..."
  install_node
fi
if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required. Install it and re-run." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm@10
fi
command -v java >/dev/null 2>&1 || echo "Note: Java not found (Minecraft servers auto-download a JRE when needed)."

if [ -d "$DIR/.git" ]; then
  echo "Updating existing checkout..."
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  echo "Cloning..."
  git clone --depth 1 -b "$BRANCH" "https://github.com/$REPO.git" "$DIR"
fi

cd "$DIR"
echo "Installing dependencies..."
pnpm install
echo "Building..."
pnpm -r --workspace-concurrency=1 build

echo ""
echo "== ChickenPanel ready in $DIR =="
echo "Run the full panel here:"
echo "  cd \"$DIR\""
echo "  node apps/cli/dist/index.js install   # first time: init database"
echo "  node apps/cli/dist/index.js start      # db + api + web  ->  http://<your-server-ip>:3000"
echo ""
echo "Or connect this machine as a NODE to an existing panel:"
echo "  cd \"$DIR\""
echo "  node apps/cli/dist/index.js node register http://PANEL_IP:4000 YOUR_TOKEN"
echo "  node apps/cli/dist/index.js start agent"
