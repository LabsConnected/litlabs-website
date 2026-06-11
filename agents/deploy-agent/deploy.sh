#!/bin/bash
# Deploy Agent -- Auto-deploys to Vercel when changes are detected

LOG_FILE="/home/litbit/LiTTreeLabstudios/agents/logs/deploy-$(date +%Y%m%d).log"
PROJECT_DIR="/home/litbit/LiTTreeLabstudios"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Deploy Agent Starting ==="

cd "$PROJECT_DIR"

# Check for uncommitted changes
changes=$(git status --porcelain 2>/dev/null | wc -l)
if [ "$changes" -gt 0 ]; then
  log "Found $changes uncommitted changes, committing..."
  git add -A
  git commit -m "Auto-deploy: $(date '+%Y-%m-%d %H:%M:%S')" --no-verify 2>/dev/null
fi

# Ensure PATH includes Node/npm for npx
export PATH="/home/litbit/.nvm/versions/node/v22.22.3/bin:$PATH"

# Push to trigger Vercel auto-deploy
log "Pushing to origin/main..."
git push origin main 2>&1 | tee -a "$LOG_FILE"

# Also deploy directly via Vercel CLI as backup
log "Running Vercel deploy..."
/home/litbit/.nvm/versions/node/v22.22.3/bin/npx vercel --prod --yes 2>&1 | tee -a "$LOG_FILE"

if [ $? -eq 0 ]; then
  log "Deploy triggered successfully"
else
  log "ERROR: Push failed"
fi
