#!/bin/bash
# Fix Hermes scripts - Run this in Termux
# Copy to Termux: termux-setup-storage && cp /sdcard/Download/fix-hermes.sh ~/ && bash ~/fix-hermes.sh

set -e

echo "=== Hermes Fix Script ==="
echo ""

# 1. Fix scanner-lib.sh - mktemp and Gemini key loading
echo "[1/6] Fixing scanner-lib.sh..."
if [ -f "$HOME/.hermes/scripts/lib/scanner-lib.sh" ]; then
    # Fix mktemp fallback
    sed -i 's|mktemp /data/data/com.termux/files/usr/tmp/|mktemp -p /data/data/com.termux/files/usr/tmp/|g' "$HOME/.hermes/scripts/lib/scanner-lib.sh" 2>/dev/null || true
    
    # Fix Gemini key loading paths
    sed -i 's|for envfile in "$HOME/.hermes/.env" "$HOME/.env"; do|for envfile in "$HOME/LiTTreeLabstudios/.env.local" "$HOME/.env.local" "$HOME/.hermes/.env" "$HOME/.env"; do|g' "$HOME/.hermes/scripts/lib/scanner-lib.sh" 2>/dev/null || true
    
    echo "  ✅ scanner-lib.sh fixed"
else
    echo "  ⚠️  scanner-lib.sh not found"
fi

# 2. Fix money-finder.sh
echo "[2/6] Fixing money-finder.sh..."
if [ -f "$HOME/.hermes/scripts/agents/money-finder.sh" ]; then
    # Fix mktemp fallback
    sed -i 's|mktemp /data/data/com.termux/files/usr/tmp/|mktemp -p /data/data/com.termux/files/usr/tmp/|g' "$HOME/.hermes/scripts/agents/money-finder.sh" 2>/dev/null || true
    
    # Fix Gemini key loading paths
    sed -i 's|for envfile in "$HOME/.hermes/.env" "$HOME/.env"; do|for envfile in "$HOME/LiTTreeLabstudios/.env.local" "$HOME/.env.local" "$HOME/.hermes/.env" "$HOME/.env"; do|g' "$HOME/.hermes/scripts/agents/money-finder.sh" 2>/dev/null || true
    
    echo "  ✅ money-finder.sh fixed"
else
    echo "  ⚠️  money-finder.sh not found"
fi

# 3. Fix daily-digest.sh
echo "[3/6] Fixing daily-digest.sh..."
if [ -f "$HOME/.hermes/scripts/agents/daily-digest.sh" ]; then
    sed -i 's|for envfile in "$HOME/.hermes/.env" "$HOME/.env"; do|for envfile in "$HOME/LiTTreeLabstudios/.env.local" "$HOME/.env.local" "$HOME/.hermes/.env" "$HOME/.env"; do|g' "$HOME/.hermes/scripts/agents/daily-digest.sh" 2>/dev/null || true
    echo "  ✅ daily-digest.sh fixed"
else
    echo "  ⚠️  daily-digest.sh not found"
fi

# 4. Clean up stale directories
echo "[4/6] Cleaning stale directories..."
for dir in "$HOME/extract_temp" "$HOME/temp_home" "$HOME/\$SVC_DIR"; do
    if [ -d "$dir" ]; then
        rm -rf "$dir" 2>/dev/null && echo "  ✅ Removed $dir" || echo "  ⚠️  Could not remove $dir"
    else
        echo "  ℹ️  $dir already gone"
    fi
done

# 5. Create .env.local symlink for Hermes if LiTTreeLabstudios exists
echo "[5/6] Setting up env file links..."
if [ -f "$HOME/LiTTreeLabstudios/.env.local" ] && [ ! -f "$HOME/.hermes/.env" ]; then
    mkdir -p "$HOME/.hermes"
    ln -s "$HOME/LiTTreeLabstudios/.env.local" "$HOME/.hermes/.env" 2>/dev/null && echo "  ✅ Linked .env.local to Hermes" || echo "  ℹ️  Link already exists or failed"
else
    echo "  ℹ️  Skipping env link"
fi

# 6. Test Gemini key loading
echo "[6/6] Testing Gemini key loading..."
key=""
for envfile in "$HOME/LiTTreeLabstudios/.env.local" "$HOME/.env.local" "$HOME/.hermes/.env" "$HOME/.env"; do
    if [ -f "$envfile" ]; then
        key=$(grep -E "^(GOOGLE_API_KEY|GEMINI_API_KEY)=" "$envfile" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d ' ')
        if [ -n "$key" ] && [ ${#key} -gt 10 ]; then
            echo "  ✅ Key found in $envfile (${#key} chars)"
            break
        fi
    fi
done

if [ -z "$key" ]; then
    echo "  ❌ No Gemini key found! Add GEMINI_API_KEY to one of:"
    echo "     - ~/LiTTreeLabstudios/.env.local"
    echo "     - ~/.env.local"
    echo "     - ~/.hermes/.env"
fi

echo ""
echo "=== Hermes Fix Complete ==="
echo "Restart Hermes services if needed."
