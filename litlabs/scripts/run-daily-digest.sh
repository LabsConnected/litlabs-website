#!/bin/bash
# Daily Deploy Digest runner — safe for cron
# Example crontab (weekdays at 9:00 AM):
#   0 9 * * 1-5 /bin/bash /home/litbit/LiTTreeLabstudios/scripts/run-daily-digest.sh

PROJECT_DIR="/home/litbit/LiTTreeLabstudios"
ENV_FILE="${HOME}/.config/littree/deploy.env"

# Load environment variables (Supabase, Discord webhooks)
if [ -f "$ENV_FILE" ]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi

export PATH="/home/litbit/.nvm/versions/node/v22.22.3/bin:$PATH"

cd "$PROJECT_DIR"
node "${PROJECT_DIR}/scripts/daily-deploy-digest.mjs" 24
