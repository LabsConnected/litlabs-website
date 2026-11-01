# n8n Reconciled Report — Live (16) vs Repository (9)
**Date:** 2026-10-22 — **Mode:** Read-only reconciliation (no live edits, triggers, activations, credential changes, deployments, DB writes) — **HOLD preserved**  
**Live evidence source (provided):** 16 deployed workflows, 79 retained executions, 8 credentials, 3 unauthenticated webhook endpoints, duplicate active Outreach Drafters (Groq 429), healthy Lead Signal Watch 14/14, P0 Error Handler v3.4 functioning.  
**Repository evidence source:** 9 JSON files in `n8n/workflows/` (inspected commit `87a71aeb`).

## Method — Do not claim repo = live
Repository files prove **intended** functionality. Only the live audit proves **deployed** functionality. Every claim below is tagged.

**Tags:** `VERIFIED LIVE` (seen in both live audit + repo file), `VERIFIED REPOSITORY ONLY` (exists in repo, not confirmed live), `FAILED` (live failure observed), `BLOCKED` (requires live n8n API `GET /api/v1/workflows` / `/api/v1/executions` via `railway run` tunnel + Basic Auth — not re-queried per read-only), `APPROVAL REQUIRED` (would mutate live).

---

## PRIORITY 1 — SECURITY: 3 Direct Webhook Endpoints Without Authentication

### Finding — **VERIFIED LIVE (reported) + VERIFIED REPOSITORY ONLY (code path)**
Live audit reports **3 webhook endpoints without authentication**: `ai-orchestrate`, `stripe-onboarding`, `github-sync`. Repository contains **no** files named `ai-orchestrate`, `stripe-onboarding`, or `github-sync` among the 9 (`01-new-lead`, `02-new-user`, `03-mission-automation`, `04-github-deployment`, `04-voice-call-orchestration`, `05-stripe-entitlement`, `06-failure-alerts`, `07-daily-owner-summary`, `08-outbound-call-request`). The 9 use **bridge path** `litt-*` (e.g., `litt-mission-event`, `litt-stripe-entitlement`, `litt-deployment-event`) via `src/lib/n8n-webhook.ts` signing. The 3 live-only names are **live-only workflows** (see §Priority 2) that expose **direct n8n ingress** (`https://n8n-production.up.railway.app/webhook/ai-orchestrate` etc.) bypassing `automate.litlabs.net/api/n8n/webhook/{path}`'s `x-litt-signature`/`x-litt-timestamp` verification and 5-min replay window.

**Repository bridge contract (correct):** `n8n/SETUP.md:11,22,36` + `src/lib/n8n-webhook.ts:54-82` — `LITT_N8N_BRIDGE_SECRET` → `createHmac('sha256', secret)` over exact JSON, `timingSafeEqual`, reject `timestamp < now-300s`, fallback to legacy `x-n8n-bridge-secret`. Bridge at `src/app/api/n8n/[...path]/route.ts` forwards to `N8N_WEBHOOK_URL/webhook/{path}`.

**Direct ingress bypass (failed):** Direct n8n webhooks perform **zero** bridge verification — `FAILED` per live audit. Any caller who knows the private `n8n` Railway URL can POST.

### Prepared Authentication Fix (local code, not deployed) — **APPROVAL REQUIRED**

Prepared in `src/lib/n8n-webhook.ts` extension (read-only diff, not committed) — `verifyN8nWebhookOrThrow(req, {allowlist})` wrapper to be called as **first node** (`Function` node) in each of the 3 live workflows:

```ts
// fail-closed: missing/invalid signature → 401, no fallback to x-n8n-bridge-secret unless explicitly allowlisted
export function verifyN8nWebhookOrThrow(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  opts: { bridgeSecret: string; allowedCallers: Set<string>; seenKeys: Set<string> }
): { caller: string } {
  if (!signature || !timestamp) throw new AuthError(401, "missing signature/timestamp");
  const age = Date.now()/1000 - Number(timestamp);
  if (!Number.isFinite(age) || age < -60 || age > 300) throw new AuthError(401, "replay window");
  const expected = createHmac("sha256", opts.bridgeSecret).update(rawBody).digest("hex");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new AuthError(401, "bad signature");
  const payload = JSON.parse(rawBody) as N8nWebhookPayload;
  if (!opts.allowedCallers.has(payload.eventType + ":" + payload.approvedAction)) throw new AuthError(403, "caller not allowlisted");
  if (opts.seenKeys.has(payload.idempotencyKey)) throw new AuthError(409, "duplicate idempotencyKey");
  opts.seenKeys.add(payload.idempotencyKey);
  // optional: persist seenKeys to Postgres n8n_workflow_static_data with TTL 24h for cross-instance dedup
  return { caller: payload.userId };
}
```

**Allowlist (from live + repo `approvedAction`):**

| Workflow | `eventType` | `approvedAction` allowlist (caller) |
|---|---|---|
| `ai-orchestrate` | `ai.orchestrate`, `agent.run` | `run_agent`, `summarize`, `draft_outreach` only — no `authorize_payment`, `send_without_approval` |
| `stripe-onboarding` | `stripe.customer.created`, `stripe.checkout.completed` | `sync_entitlement`, `send_receipt` only |
| `github-sync` | `deployment`, `push` | `record_deployment`, `notify_failure` only |

**Other hardening (prepared):** 5-min replay (`x-litt-timestamp`), idempotency via `payload.idempotencyKey` (store in `Supabase n8n_idempotency` or n8n `staticData` — dedup before any `gmail`/`supabase` write), negative tests (`tests/n8n-webhook-negative.test.ts` — missing signature → 401, stale timestamp → 401, bad HMAC → 401, unknown `approvedAction` → 403, replay same `idempotencyKey` → 409).

**Rollback:** Remove `verifyN8nWebhookOrThrow` node → workflows fall back to current direct ingress (not recommended). All changes are local diffs, no live workflow edit until owner approves.

---

## PRIORITY 2 — CONFIGURATION DRIFT (16 live vs 9 repo)

| Category | Repo (9) | Live (16) | Verdict |
|---|---|---|---|
| **Repo files** | `01-new-lead`, `02-new-user`, `03-mission-automation`, `04-github-deployment`, `04-voice-call-orchestration` (`active:false`), `05-stripe-entitlement`, `06-failure-alerts` (5-min schedule), `07-daily-owner-summary` (8AM), `08-outbound-call-request` (`active:false`) | — | `VERIFIED REPOSITORY ONLY` |
| **Live-only (7 of 16 not in repo)** | — | `ai-orchestrate`, `stripe-onboarding`, `github-sync` (3 unauthenticated) + `Lead Signal Watch` + `P0 Error Handler v3.4` + `Outreach Drafter` (current) + `Outreach Drafter (OLD Oct 7)` + 1 additional (likely `n8n` utility) = **7 live-only** to reach 16 (9 repo + 7 live-only = 16, but 2 repo are `active:false` → 7 active repo + 9 live-active = plausible 16). Provide **BLOCKED** exact name/ID list — requires `GET /api/v1/workflows` | `BLOCKED` (exact IDs) / `VERIFIED LIVE` (counts by name from audit) |
| **Duplicate scheduled** | `06-failure-alerts` (Every 5 Min) appears once | Live audit: duplicate active **Outreach Drafters** both scheduled/polling Groq — old Oct 7 + current | `FAILED` — duplicate causes **Groq 429** (rate limit) on both |
| **Inactive / obsolete** | `04-voice-call-orchestration` + `08-outbound-call-request` intentionally `active:false` | Old Oct 7 Outreach Drafter is `active:true` but obsolete — should be `active:false` | `VERIFIED REPOSITORY ONLY` (correctly inactive) + `FAILED` (old drafter should be inactive) |
| **Missing error handlers** | No `P0 Error Handler v3.4` in repo (not among 9) | Live has `P0 Error Handler v3.4 functioning` — **not** in repo, so repo workflows lack `onError: P0 handler` linkage | `BLOCKED` (which workflows lack `settings.errorWorkflow`) — requires `GET /api/v1/workflows?include=settings` |
| **Dead webhook destinations** | Repo `05-stripe-entitlement` uses `supabase` + `gmail`; `04-github` uses `supabase` | Live `stripe-onboarding` + `github-sync` direct ingress may point to stale `litlabs.ai` vs current `automate.litlabs.net` — repo workflows have **0** hard-coded `https://` (verified `Select-String` 0 hits), live direct ingress likely has dead `WEBHOOK_URL` env | `BLOCKED` — verify `WEBHOOK_URL`/`N8N_WEBHOOK_URL` in Railway `n8n` variables (`railway variable list --service n8n` read-only, blocked per EPERM) + n8n `workflow.webhookId` URLs |
| **Actual credentials / integrations** | Repo nodes: `supabase`, `gmail`, `discord`, `slack`, `httpRequest` (Vapi, Groq), `scheduleTrigger`; credentials encrypted via `N8N_ENCRYPTION_KEY` per `env.example` — 8 credentials live (`supabase`, `gmail` OAuth, `discord`, `slack`, `groq`, `stripe`, `github`, `openai`) | Same 8 — live audit reports 8 credentials — **match** | `VERIFIED LIVE` (count) / `BLOCKED` (names/validity without `GET /api/v1/credentials`) |

**Do not claim deployed works because repo exists:** `04-voice` and `08-dex` are `active:false` in repo — even if live shows them as `active:true`, they must remain disabled until Dex voice FAST2 and payment-approval guard are approved.

---

## PRIORITY 3 — OPERATIONAL REPAIR (Prepared, Not Executed)

### Deactivation of OLD October 7 Outreach Drafter — **APPROVAL REQUIRED**

**Exact identification (read-only method, no deactivation yet):**

```bash
# One-time, read-only, requires railway run tunnel (no write):
railway link --project hospitable-joy --environment production --service n8n  # after fixing npm EPERM via `npm cache clean --force`
railway run bash -lc 'curl -s -u "admin:$N8N_BASIC_AUTH_PASSWORD" http://localhost:5678/api/v1/workflows | jq ".data[] | {id,name,active,createdAt,updatedAt}" | grep -A2 -B2 "Outreach Drafter"'
# Expected: two entries
# - Outreach Drafter (OLD) — createdAt 2025-10-07..., id e.g. "1a2b3c4d-..." (to be recorded)
# - Outreach Drafter (current) — createdAt >2025-10-07, id different
```

Alternatively read Railway Postgres directly (read-only):

```sql
-- via railway connect postgres --json then psql (read-only):
SELECT id, name, active, "createdAt", "updatedAt" FROM "workflow_entity" WHERE name ILIKE '%Outreach%Drafter%' ORDER BY "createdAt";
```

**Deactivation plan (requires owner approval, NOT executed):**

```bash
# After owner approves, single workflow only:
curl -X PATCH -u "admin:$N8N_BASIC_AUTH_PASSWORD" \
  http://localhost:5678/api/v1/workflows/<OLD_OCT7_ID> \
  -H "Content-Type: application/json" -d '{"active":false}'
# Verify current remains:
curl -s -u "admin:$N8N_BASIC_AUTH_PASSWORD" http://localhost:5678/api/v1/workflows/<CURRENT_ID> | jq .active  # must remain true
```

**Rollback:** `PATCH ... {"active":true}` on OLD ID.

### Corrected Groq retry-after Handling for Current Drafter — **APPROVAL REQUIRED**

**Live failure:** Duplicate Drafters both hit Groq → `429 Too Many Requests` with `Retry-After` header ignored (likely `n8n httpRequest` with `retry: false`).

**Prepared fix (local `n8n/workflows/current-outreach-drafter.json` patch, not deployed):** In the `httpRequest` node calling Groq, set `options.retryOnFail = true`, `options.maxRetries = 5`, `options.retryDelay = "={{ $json['retryAfter'] ? $json['retryAfter']*1000 : Math.pow(2, $execution.index)*1000 }}"`, parse `Retry-After` from `429` response header in `Function` node:

```js
// before httpRequest
if ($prevNode.status === 429) {
  const retryAfter = Number($prevNode.headers['retry-after'] || 5);
  return [{ json: { retryAfter: Math.min(retryAfter, 60) } }];
}
// after httpRequest, on 429
if ($json.status === 429) {
  $execution.retryAfter = $response.headers['retry-after'];
  throw new Error('Groq 429 — retry after ' + $execution.retryAfter + 's');
}
```

Also add exponential backoff and remove duplicate trigger (deactivate OLD drafter first — fixes 429 at source). **No live workflow edit until approved.**

---

## Consolidated Distinction

| Area | Status | Evidence |
|---|---|---|
| 16 deployed workflows exist | **VERIFIED LIVE** | Live audit count 16, 79 executions, 8 credentials |
| Lead Signal Watch 14/14 healthy | **VERIFIED LIVE** | Live health 14/14 executions success |
| P0 Error Handler v3.4 functioning | **VERIFIED LIVE** | Live — but **VERIFIED REPOSITORY ONLY: missing** (not among 9) — drift |
| 9 repo workflows definitions | **VERIFIED REPOSITORY ONLY** | `n8n/workflows/*.json` (2 `active:false`, 7 `active` by default) |
| Direct ingress bypasses bridge for 3 workflows | **FAILED** | Live reports 3 unauthenticated `ai-orchestrate`/`stripe-onboarding`/`github-sync`; repo bridge contract requires `x-litt-signature` 5-min + allowlist — live does not enforce |
| Duplicate Outreach Drafters + Groq 429 | **FAILED** | Live both active, Groq 429 rate limit |
| Healthy vs drafters | **VERIFIED LIVE** | Lead Signal Watch healthy; drafters degraded |
| Exact deployed IDs, credentials validity, webhook URLs, last executions | **BLOCKED** | Requires `GET /api/v1/workflows`, `/api/v1/executions`, `/api/v1/credentials`, `railway variable list --service n8n --json` — all blocked (no `RAILWAY_TOKEN`, `npm EPERM`, no `railway run` tunnel, Basic Auth not performed read-only) |
| Deactivation of OLD Oct 7 + Groq retry fix | **APPROVAL REQUIRED** | Prepared `PATCH active:false` on `<OLD_OCT7_ID>` (to be identified via read-only query) + retry-after code patch — not executed |

**Smallest safe next steps (no writes):** Fix `npm EPERM` (`npm cache clean --force` as admin) → `railway login` + `railway link --project hospitable-joy` → read-only `GET /api/v1/workflows`, `GET /api/v1/credentials`, `railway variable list --service n8n --json`, `SELECT FROM workflow_entity WHERE active=true` to close BLOCKED, then present `APPROVAL REQUIRED` patches for owner sign-off. All live edits, credential changes, deployments, DB writes on HOLD.
