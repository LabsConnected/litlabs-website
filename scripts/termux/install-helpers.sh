#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

for f in litt-local litt-status litt-sync litt-save litt-pr; do
  install -m 755 "$ROOT/scripts/termux/bin/$f" "$PREFIX/bin/$f"
  echo "✓ installed $f"
done

hash -r 2>/dev/null || true

echo
echo "✅ LiTT Termux helpers installed."
