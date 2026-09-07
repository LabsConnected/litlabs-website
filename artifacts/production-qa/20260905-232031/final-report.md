# Production Browser QA — Final Report

**Date:** 2026-09-06  
**QA Agent:** Devin (autonomous Playwright)  
**Production URL:** https://www.litlabs.net  
**Final production commit:** cb132725  
**Artifacts:** artifacts/production-qa/20260905-232031/

---

## PRODUCTION BROWSER QA VERDICT: PASS

---

## Phases Completed

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Public / Signed-out experience | ✅ PASS |
| 2 | Real Clerk auth | ✅ PASS |
| 3 | Studio | ✅ PASS |
| 4 | Billing | ✅ PASS |
| 5 | API + Network validation | ✅ PASS |
| 6 | Terminal / Realtime features | ✅ PASS |
| 7 | Mobile QA | ✅ PASS |
| 8 | Visual quality | ✅ PASS (1 P1 fixed) |
| 9 | Failure / Edge states | ✅ PASS |

---

## Phase 2: Clerk Auth — PASS

**Method:** Headed Playwright browser — user completed Clerk sign-in manually, session saved to gitignored storageState, then full authenticated QA ran automatically.

### Authenticated API Endpoints

| Endpoint | Status | Result |
|----------|--------|--------|
| Clerk session touch (GET /api/wallet) | 200 | ✓ session valid |
| GET /api/account | 200 | ✓ `{"synced":true,"isNew":false}` |
| GET /api/wallet | 200 | ✓ balance: 580 LiTTBits |
| GET /api/settings/profile | 200 | ✓ user profile returned |
| GET /api/user/ensure | 200 | ✓ `{"exists":true,"balance":500}` |
| GET /api/affiliate/track-lead | 405 | ✓ correct (POST endpoint, GET → 405) |
| GET /api/studio-projects | 200 | ✓ projects list returned |

### Session Persistence
- Refresh retains session: ✓ (HTTP 200 after reload)
- Post-logout protection: ✓ (all endpoints → 401, /studio → redirect to /sign-in)

---

## Phase 3: Studio — PASS

- Studio loads authenticated: ✓ (HTTP 200)
- Composer/input elements: 1 ✓
- Project/workspace text: ✓
- Non-destructive interaction: typed test message, cleared (not submitted) ✓
- Refresh retains session in Studio: ✓
- Mobile studio: loads, no horizontal scroll ✓
- Console errors in Studio: **0** (after CSP fix)

---

## Defects Found and Fixed

### P1: Mobile hero command deck overflow (PR #147 — MERGED)

- **Severity:** P1
- **Reproduction:** Open homepage on 390px or 360px viewport — right side of hero text and command deck preview clipped
- **Root cause:** `aspect-[1.15/1]` with `min-h-[500px]` forced 575px width (500×1.15), overflowing mobile viewport
- **Fix:** Changed to `aspect-[0.75/1]` (portrait), removed min-height
- **Commit:** f8df081a (merged)
- **Verification:** 0 overflow elements on both mobile viewports

### P1: CSP blocking terminal WebSocket (PR #149 — MERGED)

- **Severity:** P1
- **Reproduction:** Open Studio authenticated — 10+ CSP violation console errors, terminal WebSocket blocked
- **Root cause:** CSP `connect-src` listed `https://litlabs.net` (apex only) but not `*.litlabs.net` subdomains. Terminal server at `terminal.litlabs.net` was missing.
- **Fix:** Added `https://*.litlabs.net wss://*.litlabs.net` to `connect-src`
- **Commit:** cb132725 (merged)
- **Verification:** 0 CSP errors, 0 console errors, 0 hydration errors in Studio post-deploy

### P2: React hydration error #418 in Studio — RESOLVED by CSP fix

- **Severity:** P2
- **Reproduction:** Open /studio authenticated — React error #418 in console
- **Root cause:** CSP-blocked WebSocket connection triggered hydration mismatch
- **Fix:** Resolved by the CSP fix (PR #149). Post-deploy verification shows 0 hydration errors.
- **Status:** Resolved

---

## PRs Opened and Merged

| PR | Title | Status | CI |
|----|-------|--------|----|
| #147 | fix(landing): mobile hero command deck overflow | ✅ Merged (f8df081a) | All 3 pass |
| #149 | fix(csp): allow terminal WebSocket to *.litlabs.net | ✅ Merged (cb132725) | All 3 pass |

---

## Console Errors Discovered

| Error | Severity | Count | Fix Status |
|-------|----------|-------|------------|
| CSP violation: wss://terminal.litlabs.net/socket.io/ | P1 | 10 | **FIXED** (PR #149) |
| React hydration error #418 | P2 | 1 | **FIXED** (resolved by CSP fix) |
| Total console errors after fixes | — | **0** | ✅ |

---

## Network/API Failures Discovered

**0 real network failures.** All 401s are correct auth boundaries. No localhost, stale Vercel, CORS, or 5xx errors.

---

## Screenshots Captured

**Total: 45+ screenshots** across all phases:
- Public pages (home, pricing, sign-in, sign-up) × 4 viewports
- 404 pages × 4 viewports
- Protected route redirects × 4 viewports
- Keyboard navigation
- Authenticated home (desktop + mobile)
- Studio authenticated (desktop + mobile)
- Studio after refresh
- Studio composer interaction
- Post-logout studio redirect
- Post-fix mobile home

---

## Remaining Follow-ups (Non-blocking)

1. **Clerk UserButton logout UI** — could not programmatically find/click the logout button in Playwright. The Clerk UserButton menu renders in a shadow DOM or iframe that's hard to automate. Post-logout protection was verified via fresh context instead. Not a production defect — just a test automation limitation.

2. **Touch target sizes on mobile** — some Clerk form inputs (26px height) and cookie consent buttons (31px height) are below the WCAG 2.5.5 AAA threshold (44px) but above the AA threshold (24px). These are Clerk-controlled components.

3. **`/api/affiliate/track-lead`** — returns 405 on GET (correct — it's a POST-only endpoint). The authenticated POST flow was not tested to avoid creating real affiliate tracking records.

---

## No Secrets Modified

- No secrets rotated
- No Stripe permissions changed
- No webhook endpoints modified
- No pricing changed
- No production users deleted
- No storageState/cookies/tokens committed to git
- Session file deleted after QA complete
