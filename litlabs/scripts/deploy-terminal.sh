#!/bin/bash
set -e

SERVICE="${1:-litlabs-terminal-server}"

if [ -z "$RAILWAY_TOKEN" ]; then
  echo "RAILWAY_TOKEN environment variable is required. Get it from https://railway.app/account/tokens"
  exit 1
fi

if ! command -v railway &> /dev/null; then
  echo "Installing Railway CLI..."
  npm install -g @railway/cli
fi

cd terminal-server
railway up --service "$SERVICE"
