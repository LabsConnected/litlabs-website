#!/bin/sh
# LiTTree Lab Studios — HA Add-on startup script
# Reads /data/options.json and exports env vars for the Next.js app

set -e

CONFIG_PATH=/data/options.json

# Read user options from HA Supervisor
if [ -f "$CONFIG_PATH" ]; then
    echo "[LiTree Labs] Loading user configuration..."
    GEMINI_API_KEY=$(jq -r '.gemini_api_key // empty' "$CONFIG_PATH")
    OPENROUTER_API_KEY=$(jq -r '.openrouter_api_key // empty' "$CONFIG_PATH")
    HA_SUPERVISOR_TOKEN=$(jq -r '.ha_supervisor_token // empty' "$CONFIG_PATH")
    DEBUG=$(jq -r '.debug // false' "$CONFIG_PATH")

    # Export for Next.js runtime
    export GEMINI_API_KEY="${GEMINI_API_KEY:-$SUPERVISOR_TOKEN}"
    export OPENROUTER_API_KEY="${OPENROUTER_API_KEY}"
    export HA_SUPERVISOR_TOKEN="${HA_SUPERVISOR_TOKEN:-$SUPERVISOR_TOKEN}"
    export HA_WS_URL="ws://supervisor/core/websocket"
    export HA_API_URL="http://supervisor/core/api"
    export HA_ADDON_MODE="true"
    export DEBUG="${DEBUG}"
    export NODE_ENV="production"
    export PORT="3000"
    export HOSTNAME="0.0.0.0"
else
    echo "[LiTree Labs] No options.json found — running in standalone mode"
    export HA_ADDON_MODE="false"
    export NODE_ENV="production"
    export PORT="3000"
    export HOSTNAME="0.0.0.0"
fi

# Generate .env.local for Next.js standalone server
cat > /usr/share/nginx/html/.env.local <<EOF
GEMINI_API_KEY=${GEMINI_API_KEY:-}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
HA_SUPERVISOR_TOKEN=${HA_SUPERVISOR_TOKEN:-}
HA_ADDON_MODE=${HA_ADDON_MODE}
EOF

echo "[LiTree Labs] Starting Nginx on port ${PORT}..."
echo "[LiTree Labs] HA Add-on mode: ${HA_ADDON_MODE}"

# Start nginx in foreground
nginx -g 'daemon off;'
