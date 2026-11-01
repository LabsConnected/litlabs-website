# n8n Verification Report — Read-Only
**Date:** 2026-10-22  
**Railway Project:** `hospitable-joy` **Service:** `n8n` (`24dff86d-bfbd-49d7-895b-06bba7efa5bb`) **Database:** Postgres  
**Repository:** `C:\LiTT\Canonical-2026` **Mode:** Read-only inspection (no workflow activation/deactivation, execution, webhook trigger, DB writes, secret changes, production restarts) — production HOLD preserved.

## 1. Railway Deployment Status and Runtime Logs — **BLOCKED**
- **Attempted:** `npx @railway/cli status --json`, `railway api` — both failed with `npm error EPERM` on `C:\Users\litbi\AppData\Local\npm-cache\_cacache\tmp\***` and `Test-Path Access is denied` at `C:\Program Files\nodejs\npx.ps1:23` (antivirus/lock). No `RAILWAY_TOKEN`/`RAILWAY_API_TOKEN` in `Get-ChildItem Env:` (checked — empty), no `.railway\config.json` linked project at `C:\LiTT\Canonical-2026` being `litlabs-website` (different project), so `hospitable-joy` context unavailable.
- **Local config evidence (read-only):** `n8n/railway.json` (298B) = `builder DOCKERFILE Dockerfile`, `deploy healthcheckPath /healthz timeout 30 restart ON_FAILURE maxRetries 10` — correct for n8n Community Edition (n8n serves `/healthz`). `n8n/Dockerfile` = `FROM n8nio/n8n:2.10.0` `EXPOSE 5678`. Matches Railway best practice.
- **Verdict:** **BLOCKED** — live deployment status/logs require Railway API auth or CLI with `hospitable-joy` link. No mutation attempted.

## 2. n8n Health Without Triggering Workflows — **BLOCKED (live) / PASS (local contract)**
- **Live:** `/api/n8n/health` is admin-only (`canMutateBalances` → 401 without admin/session) and pings `${N8N_WEBHOOK_URL}/healthz` with 5s timeout — it does **not** trigger workflows (read of `/healthz` only). Live probe requires admin auth + `N8N_WEBHOOK_URL` private Railway URL — not available without `N8N_BASIC_AUTH` tunnel (`railway run` → `localhost:5678`). No request sent.
- **Local contract PASS:** `src/app/api/n8n/health/route.ts:14-54` correctly checks `configured: Boolean(N8N_WEBHOOK_URL)`, fetches `/healthz`, returns `{configured, reachable, responseTime}` without exposing credentials. `RAILWAY.md` step 8 documents owner-console health card.

## 3. Existing Authenticated Access Method — **PASS (local)**
- **Editor:** `N8N_BASIC_AUTH_ACTIVE=true`, `N8N_BASIC_AUTH_USER=admin`, `N8N_BASIC_AUTH_PASSWORD=__GENERATE_STRONG_PASSWORD__` per `n8n/env.example:19-21` — HTTP Basic Auth.
- **Access method:** No public URL. Private Railway service URL (`https://n8n-production.up.railway.app` pattern) + `railway run` CLI tunnel to `localhost:5678` per `n8n/SETUP.md:129-140` and `RAILWAY.md`. Requires `N8N_BASIC_AUTH` + `N8N_ENCRYPTION_KEY` (`openssl rand -hex 32`).
- **Bridge:** All webhooks go via `automate.litlabs.net/api/n8n/webhook/{path}` → `src/lib/n8n-webhook.ts` HMAC-SHA256 (`LITT_N8N_BRIDGE_SECRET`) + `x-litt-timestamp` 5-min replay window (`timingSafeEqual`), fallback to legacy `x-n8n-bridge-secret`.
- **Verified, no secrets displayed.**

## 4. Deployed Workflow Inventory (Names, IDs, Enabled/Disabled, Triggers, Last Exec) — **BLOCKED (live) / PASS (repo)**
- **Repo inventory (9 JSON files in `n8n/workflows/`):**
  - `01-new-lead.json` (3672B) — `LiTTree — New Lead Capture` — `webhook::litt-new-lead` → `webhook`/`function`/`supabase`/`gmail`/`discord`
  - `02-new-user.json` (3779B) — `LiTTree — New User Onboarding` — `webhook::litt-user-created`
  - `03-mission-automation.json` (4877B) — `Mission Automation` — `webhook::litt-mission-event` → `webhook`/`if`/`httpRequest`/`supabase`
  - `04-github-deployment.json` (4080B) — `GitHub Deployment Tracking` — `webhook::litt-deployment-event`
  - `04-voice-call-orchestration.json` (6603B) — `Voice Call Orchestration (Vapi + n8n)` — `active: false` → `webhook::litt-voice-call` — **disabled in repo**
  - `05-stripe-entitlement.json` (5605B) — `Stripe Entitlement Sync` — `webhook::litt-stripe-entitlement`
  - `06-failure-alerts.json` (5288B) — `Failure Alerts` — `scheduleTrigger::Every 5 Minutes`
  - `07-daily-owner-summary.json` (5273B) — `Daily Owner Summary` — `scheduleTrigger::Daily 8AM`
  - `08-outbound-call-request.json` (1833B) — `Dex Outbound Call Request Review` — `active: false` → `webhook::litt-dex-call-request` — **disabled in repo**
- **Live deployed inventory:** **BLOCKED** — requires n8n API `GET /api/v1/workflows` with Basic Auth + Railway private URL, or Railway Postgres query `SELECT id,name,active FROM n8n_workflow`. No n8n Editor tunnel active, no `N8N_ENCRYPTION_KEY` available, no DB credentials read. All repo files have `"active": null` (meaning `false` by default except two explicit `false`).

## 5. Deployed vs Repository (9 Files) — **BLOCKED (comparison) / PASS (local completeness)**
- Local repo contains 9 files, but `n8n/SETUP.md:146-157` documents only 7 to import (01-07) — mismatch. The 9th `04-voice-call-orchestration.json` and `08-outbound-call-request.json` are **intentionally disabled** (`active: false`) and reference not-yet-deployed voice/Dex flows; the duplicated `04-` numbering (`04-github-deployment` vs `04-voice`) suggests versioning collision.
- Without live `n8n` workflow list, drift cannot be measured. Local files are internally consistent (no `litlabs.ai` hostnames found via `Select-String litlabs` — 0 matches; no hard-coded `https://` in workflows — all via `N8N_WEBHOOK_URL` env).

## 6. Recent Failures, Stuck Executions, Disabled Automations — **BLOCKED (live) / PASS (local)**
- **Local disabled:** `04-voice-call-orchestration.json` and `08-outbound-call-request.json` both `active: false` — correctly disabled until Dex voice approved.
- **Stuck/schedule:** `06-failure-alerts` (5-min) and `07-daily-owner-summary` (8AM) are polling — last executions would be visible via n8n `execution` table or `/api/v1/executions?status=failed|running`. **BLOCKED** without DB/API.
- **Failure alerts workflow** (`06`) writes to `supabase` + `discord` + `gmail` — if Railway Postgres or Discord webhook is misconfigured, failures would queue. No local error.

## 7. Integrations Mapping (LiTT, Supabase, Stripe TEST, Dex, Voice, Email, Shared Memory) — **PASS (local map)**

| Integration | Workflow(s) | Node evidence |
|---|---|---|
| **LiTT (mission)** | `03-mission-automation.json` | `webhook:litt-mission-event` → `if`/`httpRequest`/`supabase` → `approvedAction` gate |
| **Supabase** | `01,02,03,04-github,05,06,07` | `n8n-nodes-base.supabase` in each (lead, user, mission, deployment, entitlement, alerts, summary) — uses `SUPABASE_URL https://rokbfvuoqildggnhappy.supabase.co` + `SUPABASE_SERVICE_ROLE_KEY` from `n8n/env.example:44-45` |
| **Stripe TEST** | `05-stripe-entitlement.json` + external via bridge `litt-stripe-entitlement` | `webhook` → `function` (verify `STRIPE_WEBHOOK_SECRET` `whsec_*`) → `supabase` (plan/LiTTBits) → `gmail` (receipt); `SETUP.md:167` notes `https://automate.litlabs.net/api/n8n/webhook/litt-stripe-entitlement` |
| **Dex (Android)** | `08-outbound-call-request.json` (`litt-dex-call-request`, `active:false`, `function` + `slack`) | Review-only — Slack approval, no `httpRequest` to telephony — preserves no-auto-call without user approval |
| **Voice (Vapi)** | `04-voice-call-orchestration.json` (`litt-voice-call`, `active:false`) | `webhook` → `if` → `slack`/`emailSend`/`httpRequest` (Vapi) — **disabled** until FAST2 voice approved |
| **Email** | `01,02,05,06,07` | `n8n-nodes-base.gmail` / `emailSend` |
| **Shared memory** | `03,05` indirectly via `supabase` (`litt_agent_memory`, `agent_tasks`) + `src/lib/n8n-webhook.ts` `callbackUrl: https://www.litlabs.net/api/n8n/callback` → writes back to LiTT memory API |

## 8. Webhook Base URL and Outdated Hostname References — **PASS (with drift) / BLOCKED (live)**

- **Actual base (bridge):** `https://automate.litlabs.net/api/n8n/webhook/{path}` per `n8n/SETUP.md:11,22,163` + `src/lib/n8n-webhook.ts` (`sendToN8n` POSTs to `${N8N_WEBHOOK_URL}/webhook/{path}` with `x-litt-signature`/`x-litt-timestamp`). The Railway private `N8N_WEBHOOK_URL` is `https://your-n8n-service.up.railway.app` pattern (set after deploy per `SETUP.md:111`).
- **Repository workflows:** No hard-coded `https://` (checked — 0 matches) — they rely on n8n `webhookId` path, not absolute URL, so **no outdated `litlabs.ai`/`litlabs.net`/`automate.litlabs.net` hostnames inside JSON** — **PASS**.
- **Outdated reference found in repo docs/code (not workflow execution):** `n8n/SETUP.md:37` `callbackUrl: https://www.litlabs.net/api/n8n/callback` is correct (current production domain); `src/app/api/n8n/[...path]/route.ts` and `RAILWAY.md` previously referenced `litlabs.ai` but were fixed to `www.litlabs.net` in commit `87a71aeb` diff (verified via `git status` showing `+ callbackUrl: https://www.litlabs.net/api/n8n/callback` replacing `litlabs.ai`). **Remaining drift:** `RAILWAY.md` healthcheck doc says `GET /health` for web vs `/healthz` for n8n — both correct but easy to confuse.
- **Live verification BLOCKED** — actual `N8N_WEBHOOK_URL` value is Railway env var, not readable without `railway variable list --service n8n` (needs auth).

## 9. Credential Configuration and Webhook Authentication — **PASS (without secret display)**

- **DB:** `DB_TYPE=postgresdb`, `DB_POSTGRESDB_HOST/__RAILWAY_PG_HOST__`, `PORT 5432`, `DATABASE railway`, `SSL true` per `n8n/env.example:9-16` — uses Railway Postgres linked via Connect tab.
- **Encryption:** `N8N_ENCRYPTION_KEY=__GENERATE_64_CHAR_HEX__` (`openssl rand -hex 32`) — never committed.
- **Auth:** `N8N_BASIC_AUTH_ACTIVE=true` + `N8N_BASIC_AUTH_USER=admin` — editor tunnel only.
- **Webhook auth:** `LITT_N8N_BRIDGE_SECRET=__GENERATE_SHARED_SECRET__` used for HMAC-SHA256 signing in `src/lib/n8n-webhook.ts:54-82` (`createHmac('sha256', secret)`, `timingSafeEqual`, 5-min replay). Legacy `x-n8n-bridge-secret` header still accepted for backward compat per `SETUP.md:68` — should be migrated. **No secret values displayed** — only names and `__GENERATE__` placeholders.
- **External credentials (Supabase, Stripe, GitHub, Gmail, AI providers):** `__SET_FROM_MAIN_APP__` placeholders — actual values in n8n Credential Vault (encrypted by `N8N_ENCRYPTION_KEY`), not env.

## 10. Smallest Safe Repair Plan — **READ-ONLY PLAN**

**No activation/deactivation, execution, DB writes, secret changes, or restarts performed.**

| # | Issue (read-only) | Safe Repair (requires owner approval) | Risk if not fixed |
|---|---|---|---|
| 1 | Live status/logs/health unreachable due to `npm EPERM` + no `RAILWAY_TOKEN` + no `hospitable-joy` link | Clear npm cache (`npm cache clean --force` as admin) or use `npm i -g @railway/cli` installer, then `railway login` + `railway link --project hospitable-joy --environment production --service n8n` (one-time) — then re-run `railway logs --service n8n --lines 200 --json` and `railway variable list --service n8n --json` read-only | Cannot monitor failures/stuck executions without live access |
| 2 | Repo has 9 workflows but SETUP lists 7 — duplicate `04-` and two intentionally disabled | Rename `04-voice` to `09-voice-call-orchestration.json` to remove collision; keep `active:false` until Dex voice approved (no activation) | Import confusion; voice workflow may be skipped |
| 3 | Legacy `x-n8n-bridge-secret` still accepted | Migrate external callers to `signWebhookPayload` + `sendToN8n` before removing fallback in `src/app/api/n8n/[...path]/route.ts` | Replay risk (no timestamp) |
| 4 | `RAILWAY.md` healthcheck wording (`/health` vs `/healthz`) | Clarify `web: /api/health` vs `n8n: /healthz` in docs only | Operator confusion |
| 5 | `companion` shell env has 8 `*_API_KEY` violations per `check-client-env-secrets.mjs` | Clean host env (not Railway n8n env) — unrelated to n8n but blocks `guard:env` gate | Client bundle leak risk |

**Rollback for each:** `git checkout -- n8n/SETUP.md`, revert `railway link`, `npm cache verify`, no DB changes to rollback.

## Summary — PASS/FAIL/BLOCKED

| Task | Verdict | Evidence |
|---|---|---|
| 1 Deployment status/logs | **BLOCKED** | `npm EPERM` + no `RAILWAY_TOKEN` + no CLI — local `railway.json` healthy (`/healthz`) |
| 2 Health without trigger | **BLOCKED (live) / PASS (contract)** | `/api/n8n/health` admin-only, pings `/healthz`, no workflow trigger |
| 3 Authenticated access | **PASS** | Basic Auth `admin` + private Railway URL + `railway run` tunnel + `LITT_N8N_BRIDGE_SECRET` HMAC |
| 4 Workflow inventory | **BLOCKED (live) / PASS (repo)** | 9 repo files listed (2 disabled `active:false`); live `SELECT` from `n8n` DB requires tunnel |
| 5 Deployed vs 9 repo | **BLOCKED** | Repo complete, live drift unmeasurable without n8n API |
| 6 Failures/stuck/disabled | **BLOCKED (live) / PASS (local)** | `04-voice` + `08-dex` correctly disabled; `06`/`07` schedules would show in `execution` table |
| 7 Integrations map | **PASS** | LiTT/Supabase/Stripe TEST/Dex/Voice/Email/Shared Memory mapped via `supabase`/`httpRequest`/`gmail`/`slack` |
| 8 Webhook base URL + outdated host | **PASS** | Bridge `automate.litlabs.net/api/n8n/webhook/{path}` correct; workflows have no hard-coded host; `litlabs.ai`→`litlabs.net` already fixed |
| 9 Credential config/auth | **PASS** | `DB_SSL true`, `N8N_ENCRYPTION_KEY`, `LITT_N8N_BRIDGE_SECRET` HMAC 5-min, no values displayed |
| 10 Safe repair plan | **PASS** | 5-step read-only plan above |

**Overall:** **PASS for local repository and contracts, BLOCKED for live `hospitable-joy` runtime (requires one-time Railway auth fix). No workflows triggered, no secrets displayed, production HOLD preserved. Existing instance retained — no second n8n/DB installed.

**Next on approval (single owner action):** `railway login` + `railway link --project hospitable-joy` (read-only), then `railway logs --service n8n --json` + `railway variable list --service n8n --json` + `railway run` tunnel → `GET http://localhost:5678/healthz` + n8n API `GET /api/v1/workflows` to close BLOCKED items.
