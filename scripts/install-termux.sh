#!/bin/bash
# LiTT CLI Termux install script — builds from committed source.
#
# Usage on Termux:
#   cd ~/litt-canonical
#   bash scripts/install-termux.sh
#
# This script:
#   1. Builds @litt/agent-core, @litt/models, and @litlabs/litt-cli from source
#   2. Installs the litt launcher at ~/.local/bin/litt
#   3. The launcher preserves the caller's cwd (no cd ~/litt trap)
#   4. Groq support is built in — just set GROQ_API_KEY in ~/.bashrc
#
# Prerequisites:
#   - Node.js 22+ (pkg install nodejs)
#   - pnpm (npm install -g pnpm)
#   - git (pkg install git)
#
# After install:
#   export GROQ_API_KEY=gsk_your_key_here  # in ~/.bashrc
#   cd ~/litt-canonical
#   litt ask "your question"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "LiTT CLI Termux install"
echo "Project root: $PROJECT_ROOT"
echo ""

# ─── 1. Build @litt/agent-core ──────────────────────────────────────
echo "Building @litt/agent-core..."
cd "$PROJECT_ROOT/packages/litt-agent-core"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

# ─── 2. Build @litt/models ──────────────────────────────────────────
echo "Building @litt/models..."
cd "$PROJECT_ROOT/packages/litt-models"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

# ─── 3. Build @litlabs/litt-cli ─────────────────────────────────────
echo "Building @litlabs/litt-cli..."
cd "$PROJECT_ROOT/packages/litt-cli"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

# ─── 4. Install launcher ────────────────────────────────────────────
echo "Installing litt launcher..."
mkdir -p ~/.local/bin

source "$SCRIPT_DIR/lib/write-launcher.sh"
write_litt_launcher ~/litt-launcher.sh
ln -sf ~/litt-launcher.sh ~/.local/bin/litt

# Also symlink into /usr/bin for PATH compatibility
ln -sf ~/litt-launcher.sh /data/data/com.termux/files/usr/bin/litt 2>/dev/null || true

# Store the project root so the launcher can find the CLI
echo "export LITT_CLI_ENTRY=\"$PROJECT_ROOT/packages/litt-cli/dist/index.js\"" >> ~/.litt-install-path.sh

echo ""
echo "Install complete."
echo ""
echo "Verify:"
echo "  cd ~/litt-canonical"
echo "  litt doctor"
echo "  litt ask 'Say hello'"
echo ""
echo "Set Groq key (if not already):"
echo "  echo 'export GROQ_API_KEY=gsk_your_key' >> ~/.bashrc"
echo "  source ~/.bashrc"
