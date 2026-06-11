#!/bin/bash
# Setup all required environment variables for LiTTree Lab Studios
# Run this in WSL: bash scripts/setup-env.sh

set -e

echo "=== LiTTree Lab Studios — Environment Setup ==="
echo ""

# Check if we're in the project directory
if [ ! -f "package.json" ]; then
  echo "ERROR: Run this from the project root directory"
  exit 1
fi

# Ensure PATH has Node/npx
export PATH="/home/litbit/.nvm/versions/node/v22.22.3/bin:$PATH"

# Check if logged into Vercel
if ! npx vercel whoami > /dev/null 2>&1; then
  echo "Not logged into Vercel. Running 'npx vercel login'..."
  npx vercel login
fi

echo "Checking current environment variables..."
VERCEL_PROJ="larrys-projects-db0e2aa2/frontend"

echo ""
echo "=== Required Variables ==="
echo ""

# Function to check and prompt for missing env var
set_env() {
  local key=$1
  local current=$(npx vercel env ls $VERCEL_PROJ 2>/dev/null | grep "$key" || true)
  
  if [ -n "$current" ]; then
    echo "✓ $key already set"
    return 0
  fi
  
  echo ""
  echo "⚠ $key is MISSING"
  read -p "Enter value for $key (or press Enter to skip): " value
  
  if [ -n "$value" ]; then
    echo "$value" | npx vercel env add "$key" production "$VERCEL_PROJ" 2>/dev/null || \
      npx vercel env add "$key" production 2>/dev/null
    echo "✓ Set $key"
  else
    echo "  Skipped $key"
  fi
}

# Core — Auth
set_env "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
set_env "CLERK_SECRET_KEY"
set_env "CLERK_WEBHOOK_SECRET"

# Core — Supabase
set_env "NEXT_PUBLIC_SUPABASE_URL"
set_env "NEXT_PUBLIC_SUPABASE_ANON_KEY"
set_env "SUPABASE_SERVICE_ROLE_KEY"

# Core — Auth/Admin
set_env "AUTH_SECRET"
set_env "ADMIN_EMAIL"

# AI Providers
set_env "GEMINI_API_KEY"
set_env "GOOGLE_API_KEY"
set_env "HUGGING_FACE_API_KEY"
set_env "TOGETHER_API_KEY"
set_env "FAL_KEY"
set_env "MINIMAX_API_KEY"
set_env "SKYBOX_API_KEY"

# Payments
set_env "STRIPE_SECRET_KEY"
set_env "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
set_env "STRIPE_WEBHOOK_SECRET"

# Storage
set_env "R2_ACCOUNT_ID"
set_env "R2_ACCESS_KEY_ID"
set_env "R2_SECRET_ACCESS_KEY"
set_env "R2_BUCKET_NAME"

# Other
set_env "TELEGRAM_BOT_TOKEN"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Run 'npx vercel env ls' to verify all variables."
echo "Then trigger a redeploy: npx vercel --prod"
