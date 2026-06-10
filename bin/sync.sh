#!/bin/bash
echo "🔄 Starting Autonomic Sync..."
cd /home/litbit/LiTTreeLabstudios

WIP_STASHED=false
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "📦 Stashing local changes..."
  git stash push -m "autonomic-sync-wip-$(date +%s)"
  WIP_STASHED=true
fi

echo "📥 Fetching and rebasing from origin..."
git pull --rebase origin $(git rev-parse --abbrev-ref HEAD)

if [ "$WIP_STASHED" = true ]; then
  echo "📤 Reapplying local changes..."
  git stash pop
fi

if git diff --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q "package.json"; then
  echo "📦 package.json changed. Installing dependencies..."
  npm install --silent
fi

echo "✅ Sync complete!"
