# Quick Deploy Guide

## Current Status
- **Branch:** `fix/litt-project-context-memory-clean`
- **Ahead of origin:** 2 commits
- **Working tree:** Clean
- **CI Status:** Ready to run

---

## 3-Minute Deployment Path

```bash
# Step 1: Checkout and merge to main
git checkout main
git pull origin main  # ensure local main is fresh

# Step 2: Merge feature branch
git merge fix/litt-project-context-memory-clean

# Step 3: Verify
git log --oneline -3
# Should show recent fixes (agent settings, API resilience, terminal docs)

# Step 4: Push to trigger CI + deploy
git push origin main

# Step 5: Monitor
# → GitHub Actions runs docker-build.yml + test.yml
# → Railway webhook auto-deploys if configured
# → Check logs at railway.app dashboard
```

---

## Railway Deployment (If Manual)

```bash
# Ensure you're logged in
railway login

# Link to your project
railway link
# Select: litlabs-website (or your Railway project)

# Deploy
railway up
# This will:
# 1. Build with: npm install && npm run build
# 2. Start with: npm start
# 3. Attach env vars from Railway dashboard
```

---

## Verify After Deploy

```bash
# Check if live
curl https://litlabs.net/api/health
# Expected: {"ok": true, ...}

# Check logs
railway logs
# Look for errors, missing env vars, startup messages
```

---

## If Deploy Fails

1. **Check Railway logs first**
   ```bash
   railway logs | tail -100
   ```

2. **Common causes:**
   - Missing env var → Add to Railway dashboard
   - Build timeout → Increase timeout in railway.yml
   - Node version mismatch → Check engine field in package.json (should be 22.x)

3. **Rollback if needed**
   ```bash
   git revert HEAD
   git push origin main
   # Railway will auto-redeploy the previous version
   ```

---

## What Gets Deployed

- **Main app:** `npm start` runs Next.js on port 3000
- **Terminal server:** Separate dyno/process (if configured)
- **Database:** Supabase (no changes needed)
- **Secrets:** From Railway environment dashboard

---

## Post-Deploy Checklist

- [ ] App loads without errors
- [ ] Sign-up flow works
- [ ] Chat → LLM responds
- [ ] Terminal → shell commands work
- [ ] Agent switching → no crashes
- [ ] Settings → save button persists

---

## Next: Observability (Day 2+)

Once live and stable, add:

1. **Error tracking:** Sentry
   ```bash
   npm install @sentry/nextjs
   # Add SENTRY_DSN to Railway env
   ```

2. **Logs:** Datadog or New Relic
   ```bash
   npm install datadog-browser-rum
   # Add API key to Railway env
   ```

3. **Monitoring:** Uptime alerts
   - Datadog
   - PagerDuty
   - Or simple cron: curl endpoint every 5 min

---

Done. You're ready to push.
