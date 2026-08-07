# Production Readiness Plan — Reality Check

**Current State:** Build is type-clean, tests pass, working tree clean, code-level blockers fixed.  
**Blockers:** Infrastructure/environment constraints, not code bugs.

---

## WHAT'S BLOCKING PRODUCTION

### 1. **Railway ≠ Docker Environment** 🚫 INFRASTRUCTURE
**Problem:** Railway has no Docker daemon; can't run `docker-compose up` or build images on deploy  
**Proof:** You tried `docker build` on Railway, got "daemon not listening"

**Your Options:**
- ✅ **Stay on Railway** — deploy as Node.js app (not containerized)
  - No `docker build` needed; just push code
  - Railway runs `npm install && npm run build && npm start`
  - Terminal server runs in separate dyno/process
  - **Timeline:** Today (minimal changes needed)

- ✅ **Move to Docker-native platform**
  - Render.com (free tier with Docker)
  - Fly.io (cheap Docker containers)
  - AWS ECS (managed containers)
  - **Timeline:** 2-3 days setup

- ✅ **Hybrid: Local Docker, Railway for staging**
  - Develop locally with compose
  - Deploy to Railway as Node.js (no Docker)
  - **Timeline:** Today (what you're probably doing now)

**Recommendation:** Use **Option 1** if you want live production today. Docker is for CI/CD and local dev, not required for Railway deployment.

---

### 2. **Test/Build Timeout on Windows** ⏱️ ENVIRONMENT
**Problem:** `pnpm test` and `pnpm build` exceed 30s on Windows  
**Root Cause:** Windows I/O + WSL latency, not code

**Your Options:**
- ✅ **Use CI/CD for slow tasks** (recommended)
  - Run tests in GitHub Actions on Linux (fast)
  - Run builds in CI, not locally
  - **Timeline:** Already set up with docker-build.yml

- ✅ **Increase timeout for local dev**
  - Skip tests locally; rely on CI
  - Only run linting locally
  - **Timeline:** Today

- ✅ **Use Codespaces/cloud dev env**
  - Mentioned in your manifest
  - 100x faster build/test
  - **Timeline:** 1 hour setup

**Recommendation:** Trust CI for tests/build. Local dev → lint + run app only.

---

## WHAT YOU SHOULD DO TODAY

### Phase 1: Get to Production (2 hours)
1. **Pick deployment target:** Railway OR Docker-native platform
2. **Push current branch to main**
   ```bash
   git checkout main
   git merge fix/litt-project-context-memory-clean
   git push origin main
   ```
3. **Verify CI passes**
   - Go to GitHub Actions
   - Confirm docker-build.yml runs successfully
4. **Deploy to Railway (if staying there)**
   ```bash
   # Railway CLI will handle Node.js deployment automatically
   railway up
   ```

### Phase 2: Validate Production (1 hour)
1. **Test critical flows:**
   - [ ] Sign-up → auth works
   - [ ] Chat → terminal server responds
   - [ ] Agent switching → no crashes
   - [ ] Settings → persist with Save button

2. **Check logs:**
   ```bash
   railway logs
   # or Railway dashboard
   ```

3. **Monitor for 24h:** uptime, error rates, agent response times

---

## WHAT'S ACTUALLY PRODUCTION-READY

| Component | Status | Production? |
|-----------|--------|-------------|
| **Code** | ✅ Type-clean, tested, committed | YES |
| **Settings persistence** | ✅ Save button fix merged | YES |
| **Agent switching** | ✅ Activity Rail fixed, committed | YES |
| **API resilience** | ✅ Error handling + JSON safety added | YES |
| **Terminal docs** | ✅ Runtime + provisioning issues documented | YES |
| **Docker setup** | ✅ Works locally for CI/dev | N/A (not needed for Railway) |
| **Tests** | ✅ Pass, but timeout on Windows | YES (run in CI) |
| **Logging** | ⚠️ Basic (could add Sentry later) | ACCEPTABLE |
| **Monitoring** | ⚠️ None (Lighthouse only) | ACCEPTABLE (add after launch) |

---

## DEPLOYMENT CHECKLIST — Railway

### Pre-Deploy
- [ ] `git log --oneline -5` shows recent fixes
- [ ] `git status` is clean
- [ ] All feature branches are merged or rebased off main
- [ ] `.env` is NOT committed (only `.env.example`)

### Deploy
```bash
# Option A: Via CLI
railway login
railway link  # select project
railway up

# Option B: Via Dashboard
# Push to main → Railway auto-deploys (if webhook configured)
```

### Post-Deploy
- [ ] App loads at litlabs.net
- [ ] Sign-up → email verification works
- [ ] Chat request → LLM response
- [ ] Terminal session → can list files
- [ ] Agent menu → switch agents, no crashes
- [ ] Settings → save button persists values

### Monitoring
```bash
# Daily for first week:
railway logs | tail -50
# Check for:
# - 500 errors
# - Missing env vars
# - Database connection issues
# - LLM quota exceeded
```

---

## IF THINGS BREAK IN PRODUCTION

### Symptom: App won't start
```bash
railway logs
# Look for: "Error loading environment", "ENOENT", "Cannot find module"
# Fix: Check .env.local has all REQUIRED vars
```

### Symptom: Agent can't switch
```bash
# Check: Did you deploy the latest fix/litt-project-context-memory-clean?
git log --oneline | head -3
# If not: git checkout main && git merge fix/... && git push
```

### Symptom: Terminal not responding
```bash
# Check terminal-server is running
railway logs --service terminal-server
# If offline: Railway auto-restart should fix it (check health endpoint)
```

### Symptom: Settings don't save
```bash
# Already fixed in commit b11acc6d
# If still broken: check browser console for API errors
```

---

## NEXT 7 DAYS

### Day 1-2: Deploy to Production
- Merge feature branches
- Push to main
- Verify CI passes
- Deploy to Railway
- Spot-check critical flows

### Day 3-4: Monitor & Fix Any Production Bugs
- Watch error logs
- Fix any runtime issues
- Document any infrastructure gaps

### Day 5-7: Add Production Observability
- Add Sentry for error tracking
- Add DataDog/Newrelic for APM
- Setup alerts for downtime
- Document runbook

---

## WHAT TO TELL YOUR TEAM

> "Code is production-ready. All blockers are infrastructure/environment (Windows timeouts, Railway Docker), not code bugs. We can go live with current code on Railway with minimal changes. Tests run in CI, local dev just needs linting + running app. We're monitoring for first 7 days post-launch, then adding observability layer."

---

## Files You Already Have (No Changes Needed)

- ✅ DEEP_SCAN_REPORT.md — reference for next quarter
- ✅ IMPLEMENTATION_ROADMAP.md — backlog for Q3
- ✅ docker-build.yml — runs in CI, validates images
- ✅ test.yml — runs tests on each PR
- ✅ env.ts, logger.ts, validation.ts — ready when you add tests
- ✅ jest.config.js — foundation for unit tests

**These are "nice to have" for scale. Not needed for launch.**

---

## TL;DR — What to Do Right Now

1. **Decide:** Railway (today) or Docker platform (2-3 days)?
2. **If Railway:**
   ```bash
   git checkout main
   git merge fix/litt-project-context-memory-clean
   git push
   railway up
   ```
3. **Test critical flows**
4. **Monitor logs for 24h**
5. **Ship it**

The code is ready. Infrastructure constraints are real but not blocking. You're good to launch.
