#!/bin/bash
# Writes the litt shell launcher to the given destination path, with a
# shebang matching the platform's actual bash location (see
# launcher-shell.sh — Termux has no /bin/bash).
#
# Usage: write_litt_launcher <dest-path>

SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_LIB_DIR/launcher-shell.sh"

write_litt_launcher() {
  local dest="$1"
  local bash_path
  bash_path="$(get_launcher_bash_path)"

  printf '#!%s\n' "$bash_path" > "$dest"
  cat >> "$dest" << 'LAUNCHER_EOF'
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

  chmod +x "$dest"
}
