#!/data/data/com.termux/files/usr/bin/bash
set +e
OUT=~/litt-sync-output.txt
exec > "$OUT" 2>&1

echo "=== LITT TERMUX SYNC ==="
echo "Date: $(date)"
echo ""

# Find litt directory — prefer the canonical ~/litt-canonical checkout.
# ~/litt is kept as a temporary fallback only (legacy phone layout, to be
# retired once ~/litt-canonical is verified end-to-end).
LITT_DIR=""
for d in ~/litt-canonical ~/litt ~/LiTT ~/repos/litt; do
  if [ -d "$d/.git" ]; then
    LITT_DIR="$d"
    break
  fi
done

if [ -z "$LITT_DIR" ]; then
  LITT_DIR=$(find ~ -maxdepth 3 -name ".git" -type d 2>/dev/null | head -5 | while read g; do
    d=$(dirname "$g")
    if basename "$d" | grep -qi litt; then
      echo "$d"
      break
    fi
  done)
fi

if [ -z "$LITT_DIR" ]; then
  echo "ERROR: Could not find LiTT directory"
  echo "Home contents:"
  ls -la ~ 2>&1
  cp ~/litt-sync-output.txt /sdcard/litt-sync-output.txt 2>/dev/null
  exit 1
fi

echo "LiTT directory: $LITT_DIR"
cd "$LITT_DIR"

echo ""
echo "=== CURRENT STATE ==="
echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo "Commit: $(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
DIRTY=$(git status --porcelain 2>/dev/null)
if [ -n "$DIRTY" ]; then
  echo "Dirty: YES"
  git status --short 2>&1 | head -20
else
  echo "Dirty: NO"
fi
echo ""

echo "=== REMOTE ==="
git remote -v 2>&1
echo ""

echo "=== FETCHING ORIGIN ==="
git fetch origin 2>&1
echo ""

echo "=== STASH IF DIRTY ==="
STASHED=""
if [ -n "$(git status --porcelain)" ]; then
  echo "Stashing dirty changes..."
  git stash 2>&1
  STASHED=1
fi

echo "=== FAST-FORWARD TO origin/main ==="
git merge --ff-only origin/main 2>&1
echo ""

echo "=== NEW STATE ==="
echo "Branch: $(git branch --show-current)"
echo "Commit: $(git rev-parse HEAD)"
echo ""

echo "=== VERSIONS ==="
echo "Node: $(node --version 2>&1)"
echo "pnpm: $(pnpm --version 2>&1)"
echo "litt: $(which litt 2>&1)"
echo ""

echo "=== INSTALLING DEPS ==="
pnpm install 2>&1 | tail -10
echo ""

echo "=== BUILDING litt-models ==="
cd packages/litt-models && pnpm build 2>&1 | tail -5
echo ""

echo "=== BUILDING litt-cli ==="
cd ../litt-cli && pnpm build 2>&1 | tail -5
echo ""

echo "=== RELINKING ==="
pnpm link --global 2>&1
echo ""

echo "=== SMOKE TESTS ==="
echo "--- litt --version ---"
litt --version 2>&1
echo ""
echo "--- litt status ---"
cd "$LITT_DIR"
litt status 2>&1
echo ""
echo "--- litt doctor ---"
litt doctor 2>&1
echo ""
echo "--- litt check ---"
cd "$LITT_DIR"
litt check 2>&1
echo ""

echo "=== RESTORE STASH ==="
if [ -n "$STASHED" ]; then
  git stash pop 2>&1
fi

echo ""
echo "=== SYNC COMPLETE ==="
# Sync health is determined from the actual git state, not a hardcoded SHA:
# the phone HEAD must equal origin/main (which the desktop pushes to).
ORIGIN_MAIN=$(git rev-parse origin/main 2>/dev/null || echo "unknown")
PHONE_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "origin/main SHA: $ORIGIN_MAIN"
echo "Termux HEAD SHA: $PHONE_HEAD"
MATCH=$([ "$ORIGIN_MAIN" != "unknown" ] && [ "$PHONE_HEAD" = "$ORIGIN_MAIN" ] && echo "YES" || echo "NO")
echo "Match origin/main: $MATCH"

# Copy output to /sdcard so ADB can pull it
cp ~/litt-sync-output.txt /sdcard/litt-sync-output.txt 2>/dev/null
echo "Output copied to /sdcard/litt-sync-output.txt"