# Production Readiness Report — Homebase-3.0 (LiTTree LabStudios)

**QA Engineer:** Devin (supervised)
**Date:** 2026-08-07
**Repository:** `E:\LiTTreeLabStudio Prod` (GitHub: `LabsConnected/litlabs-website`)
**Branch:** `main` @ `663a3338` (with uncommitted local changes — see §6)
**Mode:** Non-destructive inspection only. No app code, config, or external service was modified.

---

## 0. Executive Summary

| Metric | Count |
|---|---|
| **Production blockers (P0)** | **3** |
| High-priority fixes (P1) | 5 |
| Medium-priority issues (P2) | 6 |
| Repository cleanup items | 8 |

**Bottom line:** The production build compiles cleanly (exit 0, 206 static pages, TypeScript passes), and the dev server serves all public routes correctly with proper auth redirects. However, **the app cannot run in production mode as-is** because every critical environment variable in `.env.local` is an empty placeholder (`""`). The proxy/middleware (`src/proxy.ts`) fails fast with a `FATAL: Clerk is not configured` error, causing **every route to return HTTP 500** under `next start`. On Vercel (where real env vars are injected), this would not occur — but the local `.env.local` is non-functional for production testing, and several code-level issues (conditional `ClerkProvider`, `useSession` outside provider, stale cache-header paths) would still bite at runtime.

---

## 1. Recommended Deployment Root & Build Command

| Item | Value |
|---|---|
| **Deployable app root** | `E:\LiTTreeLabStudio Prod` (repo root) |
| **Framework** | Next.js 16.2.11 (Turbopack) + React 19 + Tailwind v4 |
| **Package manager** | pnpm 9.15.9 (workspace root) |
| **Node version** | 22.22.3 (required: 22+) |
| **Build command** | `pnpm build` (= `next build`, confirmed by `vercel.json`) |
| **Install command** | `pnpm install --frozen-lockfile` |
| **Output directory** | `.next` |
| **Dev command** | `pnpm dev` (port 3001, Turbopack) |
| **Prod start** | `pnpm start` (port 3000) — **requires real env vars in process env, not `.env.local`** |
| **Vercel project ID** | `prj_EnE4JStJUENM89PWov574Y9q7mTy` |

**Workspace packages** (not separate app roots): `terminal-server`, `voice-server`, `cli`, `packages/litt-agent-core`.

---

## 2. Production Blockers (P0)

### P0-1: All critical env vars in `.env.local` are empty placeholders

- **Severity:** P0 — app cannot start in production mode locally
- **File:** `.env.local` (gitignored; not read by `next start`, only by `next dev`/`next build`)
- **Symptom:** `next start` → every route returns HTTP 500 `Internal Server Error` (21 bytes)
- **Root cause:** Every critical secret is set to `""` (empty quoted string):
  - `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `CLERK_WEBHOOK_SECRET`, `AUTH_SECRET`
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  - `HUGGING_FACE_API_KEY`, `TOGETHER_API_KEY`, `FAL_KEY`, `MINIMAX_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`
- **Evidence:** `/api/health` returns `{"status":"degraded","checks":{"env":{"status":"degraded","detail":"Missing: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"}}}`
- **Note:** On Vercel, env vars are injected from the project settings, not `.env.local`, so production deploys may work if the Vercel project has real secrets configured. **This was not verified** (safety rule: no external service changes).
- **Fix:** Populate `.env.local` with real secrets for local testing; ensure Vercel project env vars are set for production.

### P0-2: Proxy/middleware throws FATAL at module load when Clerk is unconfigured

- **Severity:** P0 — single point of failure for ALL routes
- **File:** `src/proxy.ts` lines 226-234
- **Symptom:** `Error: FATAL: Clerk is not configured. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, or set ALLOW_ANONYMOUS_DEV=true for local development.`
- **Root cause:** `isClerkConfigured()` is called at module top-level (line 203). If it returns false, the module throws, which crashes the middleware before any route handler runs. Because the proxy matcher covers all non-static routes, **every dynamic route returns 500**.
- **Aggravating factor:** `isAnonymousDevAllowed()` (line 247-252) returns `false` when `NODE_ENV === "production"`, so `ALLOW_ANONYMOUS_DEV=true` is ignored by `next start` (which sets `NODE_ENV=production`). There is **no way to run the production build locally without real Clerk keys**.
- **Evidence:** Server log shows repeated `FATAL: Clerk is not configured` on every request; all 30 tested routes return 500.
- **Fix:** Wrap the FATAL throw in a try/catch that degrades to a passthrough/landing-only mode, OR move the check out of module top-level into the request handler with a single startup log. At minimum, allow `ALLOW_ANONYMOUS_DEV` to work in production for local testing of the production build.

### P0-3: Conditional `ClerkProvider` causes `useSession` errors when Clerk keys are missing

- **Severity:** P0 — runtime errors on multiple pages when Clerk is unconfigured
- **Files:** `src/app/layout.tsx` lines 100-213; components calling `useSession()`/`useUser()` directly from `@clerk/nextjs`
- **Symptom:** Dev server log: `Error: useSession can only be used within the <ClerkProvider /> component.` (repeated on `/`, `/sign-in`, `/resources/facebook-growth`, and others)
- **Root cause:** `layout.tsx` checks `hasClerk` (line 100-101) and only renders `<ClerkProvider>` when the publishable key is present. When it's absent/empty, children render inside `<ClerkAuthContextProvider clerkAvailable={false}>` (the `NoClerkAuth` branch) — but **any component that calls `useSession()` or `useUser()` directly from `@clerk/nextjs`** (not via `useClerkAuthContext()`) crashes because there's no ClerkProvider in the tree.
- **Conflict with home AGENTS.md:** The home `AGENTS.md` states "ClerkProvider wraps the app in layout.tsx — always rendered" and "was conditionally skipped before, causing useUser/useAuth to crash during SSG". This fix was **not applied** in the repo `AGENTS.md` — the conditional skip is still present.
- **Evidence:** 4 `useSession` errors in dev log across 3 routes; pages still return 200 because error boundaries catch it, but auth-dependent UI is broken.
- **Fix:** Either (a) always render `<ClerkProvider>` with a dummy/placeholder key when real keys are absent (Clerk gracefully degrades), or (b) audit all components calling `useSession()`/`useUser()` directly and route them through `useClerkAuthContext()` which has a `NoClerkAuth` fallback.

---

## 3. High-Priority Fixes (P1)

### P1-1: `nixpacks.toml` specifies Node 20; repo requires Node 22+

- **File:** `nixpacks.toml` line 12 — `nixPkgs = ["nodejs_20", ...]`
- **Impact:** Railway terminal-server build uses Node 20, but `package.json` and CI require Node 22+. Native modules (node-pty) may have ABI mismatch.
- **Fix:** Change `nodejs_20` → `nodejs_22`.

### P1-2: Port mismatch across configs

- **Files:** `package.json` (`-p 3001`), `docker-compose.yml` (port 3000), `next.config.ts` `allowedDevOrigins` (includes `192.168.0.77`), home `AGENTS.md` (says 3000)
- **Impact:** Confusion for developers; Docker healthcheck hits `:3000` but `pnpm dev` serves `:3001`.
- **Fix:** Standardize on one port (3000) across all configs, or document the split (dev=3001, docker=3000).

### P1-3: Stale cache-header paths in proxy.ts

- **File:** `src/proxy.ts` lines 245-251
- **Issue:** `setCacheHeaders()` references `/about`, `/contact`, `/login`, `/signup` — but none of these routes exist. Actual routes are `/sign-in`, `/sign-up` (no `/about` or `/contact`).
- **Impact:** Intended cache headers never apply; `/sign-in` and `/sign-up` don't get `no-store, must-revalidate`.
- **Fix:** Update path list to `["/sign-in", "/sign-up"]` and remove `/about`, `/contact`, `/login`, `/signup`.

### P1-4: Turbopack NFT warning — unintentional whole-project tracing

- **Build log:** `Encountered unexpected file in NFT list` via `next.config.ts` → `src/lib/visual-builds/capture.ts` → `orchestrator.ts` → `src/app/api/projects/[projectId]/visual-builds/[buildId]/retry/route.ts`
- **Impact:** Serverless bundle for the visual-builds retry route may include the entire project, inflating cold-start time and deployment size.
- **Fix:** Statically scope filesystem operations in `capture.ts`/`orchestrator.ts` (e.g., `path.join(process.cwd(), 'data', bar)`) or add `/*turbopackIgnore: true*/` comments.

### P1-5: `console.error` in server-side rate-limiter.ts

- **File:** `src/lib/rate-limiter.ts` line 179
- **Issue:** `console.error(...)` in the top-level catch — violates the repo's "no console in server-side code" policy (documented in home `AGENTS.md`).
- **Fix:** Replace with structured logging via `agent-logger.ts` or a silent error counter.

---

## 4. Medium-Priority Issues (P2)

### P2-1: Upstash Redis not configured (4 build warnings + 2 startup warnings)

- **Symptom:** `[Upstash Redis] The 'url' property is missing or undefined in your Redis config.`
- **Impact:** Rate limiting falls back to in-process sliding window (per-instance, resets on cold start). Acceptable for low traffic; not production-scale.
- **Fix:** Provision Upstash Redis and set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.

### P2-2: `/api/health` returns 503; `/api/system-health` returns 503

- **Symptom:** `/api/health` → `{"status":"degraded"}` (503); `/api/system-health` → `{"error":"System health unavailable — database not configured"}` (503)
- **Impact:** Uptime monitors (Vercel, UptimeRobot) will see 503 and may flag the deployment as down even if pages render.
- **Fix:** Either configure Supabase or adjust health endpoints to return 200 with `degraded` status (not 503) when only optional services are missing.

### P2-3: `/api/voice/health` reports not configured

- **Symptom:** `{"configured":false,"available":false,"errorCode":"VOICE_NOT_CONFIGURED","message":"Voice is not configured. Missing: INWORLD_API_KEY, INWORLD_LITT_VOICE, VOICE_AUTH_SECRET."}`
- **Impact:** Voice features non-functional. Graceful failure (not a crash).
- **Fix:** Set Inworld env vars or disable voice routes with a "coming soon" banner.

### P2-4: `/agent-chat` redirects to `/studio?tool=agents` (not a 200 page)

- **Symptom:** 308 redirect from `/agent-chat` → `/studio?tool=agents`
- **Impact:** Any external links to `/agent-chat` will redirect. Not broken, but may confuse users expecting a dedicated chat page.
- **Fix:** Document the redirect or update internal links to point to `/studio?tool=agents` directly.

### P2-5: `/landing` redirects to `/` (not a standalone page)

- **Symptom:** 308 redirect from `/landing` → `/`
- **Impact:** The landing page exists as a route but redirects to home. Sitemap includes `/pricing` but not `/landing`.
- **Fix:** Confirm this is intentional (the home page IS the landing page).

### P2-6: Uncommitted local changes on `main`

- **Files modified:** `src/app/pricing/page.tsx`, `src/app/studio/hooks/useCanonicalConversation.ts`, `src/config/plans.ts`, `src/lib/rate-limiter.ts`
- **Files added (untracked):** `src/app/pricing/PricingClient.tsx`, `cf-www-redirect/`, several `.txt` debug logs
- **Impact:** Working tree is dirty on `main`; a deploy from this state would include unreviewed changes.
- **Fix:** Commit or stash changes before any deploy; clean up debug `.txt` files.

---

## 5. Repository Cleanup Items

| # | Item | Location | Action |
|---|---|---|---|
| 1 | Orphaned worktree dir (no `.git`) | `E:\LiTTreeLabStudio-worktree-pr37` | Remove or re-attach to git |
| 2 | Legacy backup with multiple `.env.*` files on disk | `E:\LiTTreeLabStudio-legacy-backup-2026-07-30` | **Security:** delete or secure — contains `.env.local`, `.env.local.bak`, `.env.local.prod`, `.env.vercel`, `.env.vercel-prod`, `.env.audit`, `.env.test`, `.env.term-check` |
| 3 | 15 internal worktrees in `.worktrees/` | `E:\LiTTreeLabStudio Prod\.worktrees\*` | Prune merged/abandoned branches via `git worktree prune` |
| 4 | 4 external worktrees on `E:` | `LiTTreeLabStudio-studio`, `-security`, `-connectors`, `-terminal` | Verify if still needed; remove if merged |
| 5 | Debug/log files in repo root | `err-launcher.txt`, `node-check.txt`, `node-err.txt`, `out-launcher.txt`, `run-tsc-check.js`, `tsc_*.txt`, `tree.txt` | Add to `.gitignore` or delete |
| 6 | `LiTTreeLabStudio-AI-Context.zip` in repo root | Repo root | Should not be in repo — move to releases or artifacts |
| 7 | Multiple status/TODO markdown files in root | `FINAL_STATUS.md`, `DEPLOY_NOW.md`, `PRODUCTION_READY_CHECKLIST.md`, `PHASE0_ARCHITECTURE_MAP.md`, `DECISION_TREE.md`, `TODO.md`, `SECURITY_INVENTORY.md`, `SITE_REFERENCE.md` | Move to `docs/` or remove |
| 8 | `architecture.manifest.json`, `dependency-graph.json` in root | Repo root | Move to `meta/` (already exists) |

---

## 6. Test Results

### 6.1 Build Test

| Step | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | ✅ Pass (lockfile up to date, 5 workspace projects, 4.2s) |
| Build | `pnpm build` | ✅ Pass (exit 0, 46s compile + 2.1min TypeScript, 206 static pages) |
| EmulatorJS verify | `prebuild` hook | ✅ Pass (all cores + runtime verified) |
| Warnings | 1 Turbopack NFT warning, 4 Upstash Redis warnings | ⚠️ See P1-4, P2-1 |

### 6.2 Route Tests — Dev Server (port 3001, `ALLOW_ANONYMOUS_DEV=true`)

All tests run with browser User-Agent `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`.

#### Public Routes (all 200 ✅)

| Route | Status | Size | Notes |
|---|---|---|---|
| `/` | 200 | 97KB | Full landing page, nav, footer, JSON-LD, OG tags |
| `/landing` | 308 | — | Redirects to `/` (intentional) |
| `/pricing` | 200 | 53KB | Pricing page renders |
| `/privacy` | 200 | 72KB | Privacy policy |
| `/terms` | 200 | 58KB | Terms of service |
| `/docs` | 200 | 35KB | Documentation |
| `/cookies` | 200 | 40KB | Cookie policy |
| `/discover` | 200 | 41KB | Discover feed |
| `/gallery` | 200 | 30KB | Gallery |
| `/showcase` | 200 | 31KB | Showcase |
| `/games` | 200 | 81KB | Games hub |
| `/games/retro` | 200 | 48KB | Retro games |
| `/games/cloud` | 200 | 54KB | Cloud games |
| `/games/dos` | 200 | 59KB | DOS games |
| `/marketplace` | 200 | 30KB | Marketplace |
| `/resources/facebook-growth` | 200 | 47KB | Resource article |

#### Auth Routes (all ✅)

| Route | Status | Notes |
|---|---|---|
| `/login` | 308 | → `/sign-in` (correct redirect) |
| `/sign-in` | 200 | Clerk sign-in form (loads client-side) |
| `/sign-up` | 200 | Clerk sign-up form (loads client-side) |

#### Protected Routes (all redirect correctly ✅)

| Route | Status | Redirect |
|---|---|---|
| `/dashboard` | 307 | → `/sign-in?redirect=%2Fdashboard` ✅ |
| `/settings` | 307 | → `/sign-in?redirect=%2Fsettings` ✅ |
| `/profile` | 307 | → `/sign-in?redirect=%2Fprofile` ✅ |
| `/wallet` | 307 | → `/sign-in?redirect=%2Fwallet` ✅ |
| `/agent-chat` | 308 | → `/studio?tool=agents` |

#### API Health Routes

| Route | Status | Notes |
|---|---|---|
| `/api/health` | 503 | `degraded` — missing Clerk + Supabase env vars |
| `/api/llm/health` | 200 | Gemini, Groq, OpenRouter all available ✅ |
| `/api/voice/health` | 200 | `configured: false` — graceful failure |
| `/api/system-health` | 503 | Database not configured |

#### Error Handling

| Route | Status | Notes |
|---|---|---|
| `/this-page-does-not-exist` | 404 | Custom 404 page with "Back to Home" + "Marketplace" links, `noindex,nofollow` ✅ |
| `/api/nonexistent` | 404 | Custom 404 page ✅ |

#### Static Assets (all 200 ✅)

| Asset | Status | Type | Size |
|---|---|---|---|
| `/favicon.ico` | 200 | image/x-icon | 25KB |
| `/icon.png` | 200 | image/png | 590KB |
| `/apple-icon.png` | 200 | image/png | 80KB |
| `/brand/litt-mascot-avatar.png` | 200 | image/png | 516KB |
| `/og/littree-labstudios.jpg` | 200 | image/jpeg | 26KB |
| `/wallpapers/litt-afterglow.webp` | 200 | image/webp | 101KB |
| `/opengraph-image.png` | 200 | image/png | 137KB |
| `/twitter-image.png` | 200 | image/png | 137KB |
| `/sitemap.xml` | 200 | XML | 1.4KB |
| `/robots.txt` | 200 | text/plain | 329B |
| `/manifest.json` | 200 | JSON | 1.6KB |

#### Security Headers (all present ✅)

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | geolocation=(), microphone=(self), camera=(self), payment=(self), usb=() |
| `Content-Security-Policy` | Full CSP with Clerk, Stripe, Supabase, AI providers whitelisted |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |

### 6.3 Route Tests — Production Server (`next start`)

**All routes return HTTP 500** due to P0-2 (FATAL Clerk error in proxy). This is the primary production blocker.

### 6.4 Console Errors (Dev Server)

| Error | Routes | Severity |
|---|---|---|
| `useSession can only be used within the <ClerkProvider />` | `/`, `/sign-in`, `/resources/facebook-growth` | P0-3 |

### 6.5 Home Page Content Verification

| Element | Present |
|---|---|
| Title tag | ✅ "LiTTree LabStudios \| AI Creative Operating System & Social Creator Platform" |
| Meta description | ✅ |
| OG tags (title, description, image, url, site_name) | ✅ |
| Twitter card | ✅ |
| Canonical URL | ✅ `https://litlabs.net` |
| JSON-LD structured data | ✅ Organization + WebSite schema |
| Header/navigation | ✅ Logo + nav links |
| Footer | ✅ |
| LiTT companion chat button | ✅ Floating button with mascot avatar |
| Theme color meta | ✅ `#03050b` |
| Manifest link | ✅ |
| Viewport meta | ✅ `device-width, initial-scale=1, maximum-scale=5` |
| Loading state | ✅ Animated spinner with progress bar |
| Background wallpaper | ✅ `litt-afterglow.webp` with constellation effect |

---

## 7. Exact Commands Run

```powershell
# 1. Locate repository
Get-ChildItem -Path C:\Users\litbi, E:\ -Directory
Get-ChildItem -Path C:\Users\litbi -Filter "*homebase*" -Recurse -Directory -Depth 3

# 2. Verify tooling
node --version          # v22.22.3
pnpm --version          # 9.15.9

# 3. Inspect git state
cd "E:\LiTTreeLabStudio Prod"
git status --short
git branch --show-current    # main
git log -1 --oneline         # 663a3338
git worktree list

# 4. Install dependencies
pnpm install --frozen-lockfile    # exit 0, lockfile up to date

# 5. Production build
pnpm build    # exit 0, 206 static pages, 1 Turbopack warning, 4 Upstash warnings

# 6. Start production server (FAILED — all routes 500)
pnpm start    # port 3000 — FATAL: Clerk is not configured
npx next start -p 3002    # same FATAL error
pnpm start -- -p 3003     # same FATAL error (ALLOW_ANONYMOUS_DEV ignored in production)

# 7. Start dev server (WORKED — all routes functional)
$env:ALLOW_ANONYMOUS_DEV="true"
pnpm dev    # port 3001

# 8. Route tests (dev server, browser User-Agent)
curl -s -o NUL -w "%{http_code} %{redirect_url} %{size_download}" -A "Mozilla/5.0 ..." http://localhost:3001/<route>

# 9. API health checks
curl -s -A "Mozilla/5.0 ..." http://localhost:3001/api/health
curl -s -A "Mozilla/5.0 ..." http://localhost:3001/api/llm/health
curl -s -A "Mozilla/5.0 ..." http://localhost:3001/api/voice/health
curl -s -A "Mozilla/5.0 ..." http://localhost:3001/api/system-health

# 10. Security header inspection
curl -sI -A "Mozilla/5.0 ..." http://localhost:3001/ | Select-String "HTTP|x-|content-security|strict-transport"

# 11. Image asset verification
curl -s -o NUL -w "%{http_code} %{content_type} %{size_download}" -A "Mozilla/5.0 ..." http://localhost:3001/<asset>

# 12. Clean rebuild (to rule out stale cache)
Remove-Item -Recurse -Force ".next"
pnpm build    # exit 0, same result
```

---

## 8. Architecture Notes

### Auth Architecture

- **Proxy/middleware:** `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`). Runs bot detection → Clerk auth → route protection.
- **Protected routes:** `/settings(.*)`, `/profile(.*)`, `/wallet(.*)`, `/dashboard(.*)`, `/agent-chat(.*)` + selected API routes. Unauthenticated → 307 redirect to `/sign-in?redirect=...` (pages) or 401 JSON (API).
- **ClerkProvider:** Conditionally rendered in `layout.tsx` based on `hasClerk` check — **conflicts with home AGENTS.md** which says it should always render.
- **Auth context:** `ClerkAuthContextProvider` has `NoClerkAuth` fallback that calls `/api/auth/session` — good design, but bypassed by components using `useSession()` directly.

### Database

- Supabase project `rokbfvuoqildggnhappy`, schema in `supabase/schema.sql` (idempotent, `public.users` table with `clerk_id` column).
- Migrations in `supabase/migrations/` — do not edit `schema.sql` directly.

### Rate Limiting

- `src/lib/rate-limiter.ts` — Supabase-backed with in-process sliding-window fallback. Well-designed. Keyed by user ID (Clerk) or IP.

### Bot Protection

- `src/proxy.ts` blocks attack tools (sqlmap, nikto, nmap, etc.), aggressive scrapers (scrapy, python-requests, curl, wget), spam bots (semrush, ahrefs). Allows Googlebot, Bingbot, social crawlers. Webhooks and health paths skip detection.

---

## 9. What Was NOT Tested (Out of Scope / Safety)

- **No accounts created, no credentials submitted** (per safety rules)
- **No payments, emails, or external API calls** with real side effects
- **No Vercel/Cloudflare/Clerk/Stripe/Supabase settings changed**
- **No production deployment triggered**
- **`.env.local` values were not read or exfiltrated** (only key names and lengths were checked)
- **Authenticated flows** — could not test without creating an account
- **WebSocket/real-time features** (terminal, voice) — require auth + external services
- **Stripe checkout** — requires real Stripe keys
- **AI generation flows** — require auth + API credits
- **Mobile responsive layout** — verified HTML structure but did not test at mobile viewport in a browser (browser preview available for manual verification at `http://localhost:3001`)

---

*Report generated by Devin QA. No app code was modified.*
