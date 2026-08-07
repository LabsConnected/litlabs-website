# litlabs.net — WAF Custom Rules Tuning Pack

**Created:** 2026-08-07
**Author:** Devin (supervised)
**Source of truth for production blockers and route evidence:** [`docs/qa/production-readiness-report.md`](./production-readiness-report.md) (hereafter "QA Report")
**Scope:** Cloudflare WAF custom rules for `litlabs.net`. This pack defines rules, deployment order, and open items. It is reconciled against the QA Report findings.

> **Do not deploy WAF rules while P0-2 is open.** WAF 403s layered on a 500-ing origin are indistinguishable during debugging. Fix the Clerk throw in `src/proxy.ts`, always render `ClerkProvider`, confirm Vercel env vars are real, then follow the phased rollout in §2. See QA Report §2 for P0 details.

---

## 0. Cross-References

- **Production blockers (P0-1/P0-2/P0-3):** QA Report §2
- **Runtime/route evidence (dev server tests):** QA Report §6.2
- **Proxy/bot-filter analysis:** QA Report §6.2 + this doc §3
- **Security headers verification:** QA Report §6.2
- **Security/backup cleanup (legacy `.env.*` files):** QA Report §5, item #2
- **Landing Claims Audit:** [`docs/qa/landing-claims-accountability-audit.md`](./landing-claims-accountability-audit.md)

---

## 1. Rule Pack

> **Rollout principle:** Start in **Log** or **Managed Challenge** mode where possible, review the traffic that hits each rule, then escalate to **Block** only after confirming no legitimate traffic is caught. User-Agent strings are spoofable — prefer Cloudflare verified bot signals where available.

### Rule 1 — Block attack tools (sqlmap, nikto, nmap, etc.)

- **Initial action:** Log
- **Escalate to:** Block (403) after reviewing logs
- **Expression:** `(http.user_agent matches "(?i)(sqlmap|nikto|nmap|masscan|dirbuster|wpscan|hydra|burpcollaborator|acunetix|nessus|zap|fiddler)")`
- **Status:** ⚠️ **Log first, then Block.** These are attack-tool signatures with low false-positive risk, but verify no internal scanners or security tools you use match these patterns before escalating.
- **QA cross-ref:** QA Report §6.2 — proxy.ts bot detection verified.

### Rule 2 — Block aggressive scrapers (scrapy, python-requests, etc.)

- **Initial action:** Log / Managed Challenge
- **Escalate to:** Block (403) only on browser-facing routes, after reviewing traffic
- **Expression:** `(http.user_agent matches "(?i)(scrapy|mechanize|python-requests|python-urllib|httpclient|httpx/[0-9]|go-http-client|java/[0-9]|okhttp/[0-9]|node-fetch|axios/[0-9]|got/[0-9]|aiohttp|perl|libwww|lwp-)")`
- **Status:** ⚠️ **Log / Managed Challenge first.** These are normal HTTP libraries, not inherently malicious. If your agents, mobile clients, integrations, testing tools, webhook providers, or partners hit your public API using these libraries, blocking them will break legitimate traffic. **Path-scope to browser-facing routes** (`/`, `/landing`, `/pricing`, `/docs`) before blocking. Do not block on `/api/*` without reviewing API client traffic first.
- **QA cross-ref:** QA Report §6.2.

### Rule 3 — Block spam bots (semrush, ahrefs, etc.)

- **Initial action:** Log
- **Escalate to:** Block (403) after reviewing logs
- **Expression:** `(http.user_agent matches "(?i)(semrush|ahrefsbot|dotbot|blexbot|bombora|petalbot|yandexbot)")`
- **Status:** ⚠️ **Log first, then Block.** These are SEO scrapers with low legitimate use for this site, but verify no partner integrations use these UAs before escalating.
- **QA cross-ref:** QA Report §6.2.

### Rule 4 — Block curl/wget (DEFERRED — see §3)

- **Action:** Block (403) — **DEFERRED**
- **Expression:** `(http.user_agent matches "(?i)(curl/[0-9]|wget/[0-9])")`
- **Status:** ⚠️ **DEFERRED.** `src/proxy.ts:41-42` already blocks curl/wget on all hosts including API routes. If agents or API clients traffic passes through the proxy, your own API clients are being blocked right now. **Move this to edge with a path exception for `/api/*` or remove from proxy.ts and let edge handle it.** See §3 for details.
- **QA cross-ref:** QA Report §6.2 — proxy.ts matcher includes `/api/*` (line 315).

### Rule 5 — Allow legitimate crawlers (Googlebot, Bingbot, etc.)

- **Action:** Skip remaining bot rules
- **Expression (preferred):** Use Cloudflare **verified bot** classification where available — `(cf.bot_management.verified_bot)` or the "Verified Bot" field in the WAF rule builder. This uses Cloudflare's reverse-validated bot list, not spoofable UA strings.
- **Expression (fallback):** `(http.user_agent matches "(?i)(googlebot|bingbot|duckduckbot|slurp|baiduspider|facebookexternalhit|twitterbot|linkedinbot|discordbot|telegrambot|whatsapp|applebot)")` — use only if verified bot signals are unavailable.
- **Status:** ⚠️ **Use verified bot signals, not UA strings alone.** Anybody can send `User-Agent: Googlebot` — that does not make them Google. Raw UA matching is a fallback, not a primary signal. Already in `src/proxy.ts:66-79` as UA-only matching — **upgrade to verified bot at the edge.**
- **QA cross-ref:** QA Report §6.2.

### Rule 6 — Block no User-Agent

- **Action:** Log — **DEFERRED for blocking**
- **Expression:** `(not http.user_agent) or (http.user_agent eq "")`
- **Status:** ⚠️ **DEFERRED for blocking.** Blocking every request with no User-Agent can break legitimate health checks, webhooks from services that don't send UA, internal services, or simple API clients. **Keep in Log mode or exclude known machine endpoints** (`/api/webhook/*`, `/api/health`, `/api/system-health`, `/metrics`). Already in `src/proxy.ts:140-148` — consider relaxing the proxy.ts version too.
- **QA cross-ref:** QA Report §6.2.

### Rule 7 — Block suspiciously long User-Agent (>512 chars)

- **Action:** Verify Cloudflare WAF action behavior before implementing
- **Expression:** `(len(http.user_agent) > 512)`
- **Status:** ⚠️ **Verify Cloudflare action semantics.** `Block (400)` is odd for a WAF rule — Cloudflare WAF actions are typically Block (403), Managed Challenge, JS Challenge, Log, or Skip. A 400 status code may not be achievable via WAF custom rule actions. **Confirm what Cloudflare actually returns for the Block action and adjust the status-code expectation.** Already in `src/proxy.ts:168-176` returning 400 — the proxy.ts behavior is correct for app-level middleware, but the WAF rule may behave differently.
- **QA cross-ref:** QA Report §6.2.

### Rule 8 — Subdomain host-scoping (DEFERRED — see §4)

- **Action:** Varies (read-only method block, crawler/hotlink rules)
- **Status:** ⚠️ **DEFERRED.** `gallery.litlabs.net`, `games.litlabs.net`, `music.litlabs.net` all return **Cloudflare HTTP 530** (origin unreachable). These are not currently serving traffic. Path-scoped vs host-scoped rules are moot until the subdomains have working origins. **Re-validate when subdomains are configured.** See §4.

### Rule 9 — Protect `/api/llm/health` from information disclosure

- **Action:** **App-code change preferred over WAF auth.**
- **Current behavior:** `/api/llm/health` returns 200 with full AI supply chain enumeration: `{"gemini":{"available":true,"model":"gemini-2.5-flash"},"groq":{"available":true,"model":"llama-3.3-70b-versatile"},"openrouter":{"available":true,"model":"openrouter/free"},...}`
- **Risk:** Free map of AI supply chain, model names, and provider availability. Useful for reconnaissance.
- **Status:** ⚠️ **Prefer changing the endpoint response in app code** to a minimal public health payload (`{"status":"ok"}`) and expose detail only to authenticated/internal callers. WAF auth is not the same thing as application auth — a WAF rule that "restricts" this endpoint may not enforce the same identity/session checks as the app. **This is an app-code fix, not a WAF rule.**
- **QA cross-ref:** QA Report §6.2 — `/api/llm/health` returns 200 with full model enumeration.

### Rule 10 — Skip bot detection for webhooks

- **Action:** Skip bot-detection rules only (Rules 1–4, 6–7), not all WAF rules
- **Expression:** `(http.request.uri.path in {"/api/webhook/clerk" "/api/webhooks/meta-developer" "/api/github/webhook" "/api/gitlab/webhook" "/api/webhook/agent-action" "/api/stripe/webhook"})`
- **Status:** ⚠️ **Narrow the skip scope.** "Skip rules 1–7" is too broad unless ordering and skip scope are carefully defined. Skip only the specific bot/UA rules that would interfere with webhook delivery. Do not accidentally bypass unrelated security rules. Already in `src/proxy.ts:82-89`. Webhooks verify signatures themselves.
- **QA cross-ref:** QA Report §6.2.

### Rule 11 — Skip bot detection for health paths

- **Action:** Skip bot-detection rules only (Rules 1–4, 6–7), not all WAF rules
- **Expression:** `(http.request.uri.path in {"/api/health" "/api/llm/health" "/api/voice/health" "/api/system-health" "/metrics"})`
- **Status:** ⚠️ **Narrow the skip scope.** Same as Rule 10 — skip only the bot/UA rules that would interfere with health check probes. Do not bypass unrelated security rules. Already in `src/proxy.ts:92-98`.
- **QA cross-ref:** QA Report §6.2.
- **Note:** If Rule 9 restricts `/api/llm/health` response payload (via app code), this skip is only about bot detection, not auth.

### Rule 12 — Cache headers for public pages → Cache Rules, not WAF

- **Action:** Move to Cloudflare **Cache Rules** / response headers, not WAF custom rules
- **Paths:** `/docs`, `/pricing`
- **Status:** ⚠️ **This is a cache-policy/configuration concern, not a classic WAF protection.** Put it under Cloudflare Cache Rules or response header modification, not in the WAF blocklist section. Already in `src/proxy.ts:265-267` (now fixed — stale `/about`, `/contact` paths removed).
- **QA cross-ref:** QA Report P1-3 — stale cache paths fixed in proxy.ts.

### Rule 13 — No-store for auth pages → Cache Rules, not WAF

- **Action:** Move to Cloudflare **Cache Rules** / response headers, not WAF custom rules
- **Paths:** `/sign-in`, `/sign-up`
- **Status:** ⚠️ **This is a cache-policy/configuration concern, not a classic WAF protection.** Put it under Cloudflare Cache Rules or response header modification. Already in `src/proxy.ts:270-272` (now fixed — stale `/login`, `/signup` paths updated to `/sign-in`, `/sign-up`).
- **QA cross-ref:** QA Report P1-3 — stale cache paths fixed in proxy.ts.

---

## 2. Phased Deployment Order

> **Principle:** Deploy the safest, highest-value rules first. Review traffic logs at each phase before escalating to Block.

### Phase 0 — Prerequisites (must be done first)

1. **Fix P0-2** (QA Report §2) — move Clerk check out of module top-level in `src/proxy.ts` ✅ Done
2. **Fix P0-3** (QA Report §2) — route direct Clerk hooks through fallback ✅ Done
3. **Verify Vercel env vars are real** (QA Report §2, P0-1) — without exposing values ✅ Verified (all encrypted, present in production)
4. **Run clean production-mode smoke test** — `next start` with real env vars

### Phase 1 — Deploy first (safest, highest value)

1. **Rule 9 — Protect `/api/llm/health`** — reduce public response payload via app code (not WAF auth)
2. **Rule 10 — Webhook exclusions** — narrowly scoped skip of bot-detection rules only
3. **Rule 13 — Auth no-store cache policy** — via Cache Rules, not WAF
4. **Rule 1 — Attack tools** — start in **Log** mode

### Phase 2 — After reviewing Phase 1 logs

5. **Rule 1 — Attack tools** — escalate Log → Block after confirming no false positives
6. **Rule 3 — Spam bots** — start in Log mode, escalate to Block after review
7. **Rule 12 — Public page cache headers** — via Cache Rules

### Phase 3 — After reviewing Phase 2 logs

8. **Rule 2 — Aggressive scrapers** — start in Log / Managed Challenge, path-scoped to browser-facing routes only. Escalate to Block only after confirming no legitimate API client traffic is caught.
9. **Rule 5 — Allow legitimate crawlers** — use Cloudflare verified bot signals (`cf.bot_management.verified_bot`), not UA strings alone

### Phase 4 — Hold / Deferred

10. **Rule 4 — curl/wget blocking** — deferred, needs `/api/*` path exception
11. **Rule 6 — No User-Agent blocking** — deferred, needs machine-endpoint exclusions
12. **Rule 7 — Long User-Agent** — verify Cloudflare WAF action semantics (400 may not be achievable)
13. **Rule 8 — Subdomain host-scoping** — deferred until subdomains have working origins

---

## 3. Proxy/Bot-Filter Findings (Preserved)

> **These findings are valid and should be acted on regardless of WAF deployment.**

### 3.1 proxy.ts duplicates WAF rules 1–7

`src/proxy.ts:22-63` implements the same bot blocking as WAF rules 1–3, 6–7. Every request the middleware inspects costs a Vercel function invocation. **Move bot blocking to the edge (Cloudflare WAF) and remove it from proxy.ts** to reduce function invocations and cold-start costs.

### 3.2 proxy.ts blocks curl/wget on ALL hosts including API

`src/proxy.ts:41-42` blocks `curl/[0-9]` and `wget/[0-9]` with no path exception. The matcher (line 315) includes `/api/*` routes. **If agents or API clients traffic passes through the proxy, your own API clients are being blocked right now.**

**Fix:** Either:

- Add `/api/*` to the bot-detection skip list in `withBotProtection()`, OR
- Remove curl/wget blocking from proxy.ts and let Cloudflare WAF handle it with a path exception

### 3.3 proxy.ts FATAL throw crashes all routes (P0-2) — FIXED

`src/proxy.ts:226-234` previously threw `FATAL: Clerk is not configured` at module load time. This was the root cause of all routes returning 500 under `next start` without Clerk env vars. See QA Report §2, P0-2.

**Fix applied:** The check has been moved inside the request handler (`validateAuthConfig()`). The module now loads successfully regardless of Clerk configuration. `ALLOW_ANONYMOUS_DEV=true` works for local production testing when `VERCEL` is absent. Production on Vercel still requires real Clerk keys.

---

## 4. Subdomain Host-Scoping (DEFERRED)

### Status: DEFERRED — Re-validate when subdomains have working origins

**Verified 2026-08-07:**

```text
curl -sI https://gallery.litlabs.net/sign-in  →  HTTP 530 (Cloudflare origin unreachable)
curl -sI https://games.litlabs.net            →  HTTP 530
curl -sI https://music.litlabs.net            →  HTTP 530
```

All three subdomains return Cloudflare 530, meaning no origin is configured. The QA report confirms `/games`, `/gallery`, `/marketplace`, `/showcase`, `/discover` are routes **inside the single Next.js app** (206 static pages, one Vercel project — QA Report §6.1). If these subdomains are eventually configured as aliases to the same app, the read-only method block and crawler/hotlink rules must be **path-scoped, not host-scoped**, or they'll break auth and API calls on those hostnames.

**Action item (when subdomains are configured):**

1. Run `curl -I https://gallery.litlabs.net/sign-in` to confirm origin is reachable
2. Determine if subdomain is an alias to the main app or a standalone host
3. If alias: scope rules by path, not host
4. If standalone: host-scoped rules are safe

**Do not remove this recommendation. Mark it for re-validation.**

---

## 5. Security Remediation — Legacy Backup

> **Do not print or inspect secret values.** This section recommends remediation only.

The directory `E:\LiTTreeLabStudio-legacy-backup-2026-07-30` contained seven+ `.env.*` files including `.env.vercel-prod` (QA Report §5, item #2). These have been moved to a `.env-secured/` subdirectory with permissions restricted to the current user.

**If these backup files ever contained live secrets and were committed, uploaded, shared, copied outside trusted storage, or exposure is uncertain, rotate the affected credentials.** Then securely remove or archive the stale environment files.

**Recommended order of operations:**

1. **Assess exposure first** — determine whether the backup files were ever committed to git, uploaded, shared, or otherwise exposed. The QA process did not inspect the values and did not establish that the files were exposed.
2. **Rotate immediately if exposure is confirmed or uncertain** — Supabase service-role key, Stripe secret key, Clerk secret key. If the files were committed, uploaded, shared, or their handling is uncertain, treat the secrets as potentially compromised and rotate.
3. **If exposure is ruled out** — secure/delete the files (already done — moved to `.env-secured/`) and assess whether rotation is still warranted as a precaution.
4. **Verify rotation** by confirming the old keys no longer work.

**Note:** The Supabase CLI does not support service-role key rotation — this must be done via the Supabase Dashboard (Database Settings → API keys → Rotate).

**Cross-ref:** QA Report §5, item #2. Landing Claims Audit §7.

---

## 6. Rule Summary

| Rule | Initial Action | Escalate To | Status | Phase |
| --- | --- | --- | --- | --- |
| 1 | Log | Block (403) | ⚠️ Log first | Phase 1→2 |
| 2 | Log / Managed Challenge | Block (path-scoped) | ⚠️ Aggressive — review first | Phase 3 |
| 3 | Log | Block (403) | ⚠️ Log first | Phase 2 |
| 4 | — | — | ⚠️ Deferred | Phase 4 |
| 5 | Skip bot rules | — | ⚠️ Use verified bot signals, not UA | Phase 3 |
| 6 | Log | — | ⚠️ Deferred for blocking | Phase 4 |
| 7 | — | — | ⚠️ Verify CF action semantics | Phase 4 |
| 8 | — | — | ⚠️ Deferred (subdomains 530) | Phase 4 |
| 9 | App-code fix | — | ⚠️ App code, not WAF | Phase 1 |
| 10 | Skip bot rules only | — | ⚠️ Narrow skip scope | Phase 1 |
| 11 | Skip bot rules only | — | ⚠️ Narrow skip scope | Phase 1 |
| 12 | Cache Rules | — | ⚠️ Cache config, not WAF | Phase 2 |
| 13 | Cache Rules | — | ⚠️ Cache config, not WAF | Phase 1 |

---

*Pack generated by Devin. No app code was modified. No production configuration was changed. No Cloudflare settings were changed.*
