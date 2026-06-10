#!/bin/bash
# Build Agent -- Runs builds, tests, type checks

LOG_FILE="/home/litbit/LiTTreeLabstudios/agents/logs/build-$(date +%Y%m%d).log"
PROJECT_DIR="/home/litbit/LiTTreeLabstudios"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Build Agent Starting ==="

cd "$PROJECT_DIR"

# TypeScript check
log "Running TypeScript check..."
npx tsc --noEmit 2>&1 | tee -a "$LOG_FILE"
local tsc_exit=$?

if [ $tsc_exit -ne 0 ]; then
  log "ERROR: TypeScript check failed"
  exit 1
fi
log "TypeScript: OK"

# Lint check
log "Running ESLint..."
npx eslint src/ 2>&1 | tee -a "$LOG_FILE"
local lint_exit=$?

if [ $lint_exit -ne 0 ]; then
  log "WARNING: ESLint found issues"
else
  log "ESLint: OK"
fi

# Build test
log "Running production build..."
npm run build 2>&1 | tee -a "$LOG_FILE"
local build_exit=$?

if [ $build_exit -ne 0 ]; then
  log "ERROR: Build failed"
  exit 1
fi
log "Build: SUCCESS"

# Sync to Windows
log "Syncing to Windows..."
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='.env.local' \
  "$PROJECT_DIR/" \
  "/mnt/c/Users/litbi/CascadeProjects/litlabs-website/"

log "Sync to Windows: DONE"
log "=== Build Agent Complete ==="
