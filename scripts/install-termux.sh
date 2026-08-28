#!/bin/bash
# LiTT CLI Termux install script — builds from committed source.
#
# Usage on Termux:
#   cd ~/litlabs-website
#   bash scripts/install-termux.sh
#
# This script:
#   1. Builds @litt/models and @litlabs/litt-cli from the current source
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
#   cd ~/litlabs-website
#   litt ask "your question"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "LiTT CLI Termux install"
echo "Project root: $PROJECT_ROOT"
echo ""

# ─── 1. Build @litt/models ──────────────────────────────────────────
echo "Building @litt/models..."
cd "$PROJECT_ROOT/packages/litt-models"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

# ─── 2. Build @litlabs/litt-cli ─────────────────────────────────────
echo "Building @litlabs/litt-cli..."
cd "$PROJECT_ROOT/packages/litt-cli"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

# ─── 3. Install launcher ────────────────────────────────────────────
echo "Installing litt launcher..."
mkdir -p ~/.local/bin

cat > ~/litt-launcher.sh << 'LAUNCHER_EOF'
#!/bin/bash
# LiTT launcher — preserves caller's cwd (2026-08-28)
#
# Captures the caller's real cwd and passes it via --cwd so LiTT
# inspects the user's actual project, not its own install dir.
#
# CWD precedence:
#   1. explicit --cwd <path> from user
#   2. LITT_CWD env var
#   3. caller's $PWD (default)
#
# The launcher does NOT cd into any install directory — it runs
# the CLI directly from the project source.

# Resolve the CLI entry point from the project that installed this launcher
LITT_ENTRY="${LITT_CLI_ENTRY:-$(cd "$(dirname "$0")/.." && pwd)/packages/litt-cli/dist/index.js}"

if [ ! -f "$LITT_ENTRY" ]; then
  echo "Error: LiTT CLI not found at $LITT_ENTRY" >&2
  echo "Run the install script from your project root." >&2
  exit 1
fi

# Check if user already passed --cwd
has_cwd=false
for arg in "$@"; do
  if [ "$arg" = "--cwd" ]; then
    has_cwd=true
    break
  fi
done

# Inject --cwd only if user didn't pass one and LITT_CWD isn't set
if [ "$has_cwd" = false ] && [ -z "$LITT_CWD" ]; then
  exec node "$LITT_ENTRY" --cwd "$PWD" "$@"
elif [ "$has_cwd" = false ] && [ -n "$LITT_CWD" ]; then
  exec node "$LITT_ENTRY" --cwd "$LITT_CWD" "$@"
else
  exec node "$LITT_ENTRY" "$@"
fi
LAUNCHER_EOF

chmod +x ~/litt-launcher.sh
ln -sf ~/litt-launcher.sh ~/.local/bin/litt

# Also symlink into /usr/bin for PATH compatibility
ln -sf ~/litt-launcher.sh /data/data/com.termux/files/usr/bin/litt 2>/dev/null || true

# Store the project root so the launcher can find the CLI
echo "export LITT_CLI_ENTRY=\"$PROJECT_ROOT/packages/litt-cli/dist/index.js\"" >> ~/.litt-install-path.sh

echo ""
echo "Install complete."
echo ""
echo "Verify:"
echo "  cd ~/litlabs-website"
echo "  litt doctor"
echo "  litt ask 'Say hello'"
echo ""
echo "Set Groq key (if not already):"
echo "  echo 'export GROQ_API_KEY=gsk_your_key' >> ~/.bashrc"
echo "  source ~/.bashrc"
