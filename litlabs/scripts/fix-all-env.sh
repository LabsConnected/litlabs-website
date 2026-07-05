#!/bin/bash
# Fix ALL missing env vars and data for LiTTree Lab Studios
# Run in WSL: bash scripts/fix-all-env.sh

set -e

echo "========================================"
echo " LiTTree Lab Studios — Complete Fix"
echo "========================================"
echo ""

# Ensure Node/npx available
export PATH="/home/litbit/.nvm/versions/node/v22.22.3/bin:$PATH"

PROJECT_DIR="/mnt/c/home/litbit/LiTTreeLabstudios/home/litbit/LiTTreeLabstudios"
cd "$PROJECT_DIR"

# Step 1: Pull env vars from Vercel
echo "Step 1: Pulling environment variables from Vercel..."
npx vercel env pull .env.local --yes
echo ""

# Step 2: Show what's pulled (redacted)
echo "Step 2: Checking pulled environment..."
grep -v '^#' .env.local | grep -v '^$' | grep '=' | sed 's/=.*/=***REDACTED***/' | sort
TOTAL=$(grep -v '^#' .env.local | grep -v '^$' | grep '=' | wc -l)
echo ""
echo "Total env vars pulled: $TOTAL"
echo ""

# Step 3: Check for empty values
echo "Step 3: Checking for empty values..."
EMPTY_KEYS=$(grep -v '^#' .env.local | grep -v '^$' | grep '=""' | cut -d= -f1)
if [ -n "$EMPTY_KEYS" ]; then
  echo ""
  echo "⚠️  The following keys are EMPTY and need manual setup:"
  echo "$EMPTY_KEYS" | while read key; do
    echo "   - $key"
  done
  echo ""
  echo "To set them, run these commands (replace YOUR_VALUE with the real key):"
  echo "$EMPTY_KEYS" | while read key; do
    echo "   npx vercel env add $key production"
  done
else
  echo "✓ No empty values found!"
fi

echo ""
echo "========================================"
echo " Done! Redeploy with: npx vercel --prod"
echo "========================================"
