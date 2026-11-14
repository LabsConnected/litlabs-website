#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# User-facing helpers → $PREFIX/bin (on PATH everywhere in Termux).
for f in litt-local litt-status litt-sync litt-save litt-pr litt-doctor litt-supervisor; do
  install -m 755 "$ROOT/scripts/termux/bin/$f" "$PREFIX/bin/$f"
  echo "✓ installed $f -> $PREFIX/bin/$f"
done

# Device-infrastructure helpers → ~/bin. These are the scripts the
# supervisor, litt-local and the acceptance tooling actually invoke by
# absolute path ($HOME/bin/litt-heavy), so they must NOT go to $PREFIX/bin
# where a second copy could drift out of sync.
mkdir -p "$HOME/bin"
for f in litt-heavy litt-memwatch litt-crash-snap litt-recover-check litt-local-ai; do
  install -m 755 "$ROOT/scripts/termux/bin/$f" "$HOME/bin/$f"
  echo "✓ installed $f -> $HOME/bin/$f"
done

hash -r 2>/dev/null || true

echo
echo "✅ LiTT Termux helpers installed."
echo "   Prereq outside this repo: ~/private-agent/tune/dex-ctl (Ollama control)."
