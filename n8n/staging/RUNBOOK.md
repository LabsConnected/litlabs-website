# n8n Staging Runbook — Isolated Failure-Loop Proof

Proves one complete automation loop (detect → dedup → record → explain)
against **staging only**. Production and billing holds remain in effect.
**Execution is HELD until independently reviewed and explicitly approved.**

## Environment map (read-only finding)

| Component | Production | Staging |
|---|---|---|
| Next.js app | `litlabs-website` Railway project, `web` → litlabs.net | `litlabs-prNNN-preview` Railway projects |
| Supabase | `LiTTreeLabStudio_Prod` | `litlabs-preview` |
| n8n | `hospitable-joy` Railway project (n8n + Postgres) — **the only n8n in the account** | this local harness (Docker) |

**No staging n8n exists on Railway.** This compose stack is the isolated
staging instance; the engine DB is a throwaway local Postgres, and the
only external system it may touch is `litlabs-preview`.

## Prerequisites

- Docker Desktop running (`docker compose version` OK)
- `n8n/staging/.env` (never committed):
  ```
  N8N_STAGING_ENCRYPTION_KEY=<openssl rand -hex 32>
  ```
- litlabs-preview service-role key (Supabase dashboard — pasted only into
  the staging n8n credential vault, never into files)
- **Auth note:** n8n 2.x does not support `N8N_BASIC_AUTH_*`. On first
  launch, the editor walks you through creating a local **owner account**
  (email + password). Editor is bound to `127.0.0.1`, so it never leaves
  this machine.

## P0 handler — node side-effect audit (19 nodes, verified 2026-10-23)

| Category | Nodes | External effect |
|---|---|---|
| Trigger | Error Trigger | none — inbound only |
| Pure code | Normalize Error, Classify Claim Error, Confirm Fallback, Resolve Delivery Record, Fail Loudly, Capture Record Error | none — no fetch/http/require in any code node (scanned) |
| Logic | Duplicate?, Email Delivered?, Delivery Recordable?, Claim Failed?, Record Error? (if), Duplicate — Stop, Delivered — Unrecorded (noOp) | none |
| Supabase | Claim Alert Slot, Backfill Claim, Delivered — Recorded, Record Failed Delivery | writes to `n8n_alert_claims` / `n8n_alert_deliveries` — **litlabs-preview only** once rebound to the staging credential |
| Email | Send Alert Email | **DISABLED** in the export, credential scrubbed, and no Gmail cred exists in staging — cannot send even if re-enabled |

No httpRequest, webhook, Stripe, GitHub, Discord, or Slack nodes exist in
this workflow. All credential bindings were stripped at export
(`id: null`); only Supabase needs a staging binding.

## Steps

1. `cd n8n/staging && docker compose up -d` → open http://localhost:5678
   → create the local owner account (one-time, machine-local).
2. **Pre-flight:** on litlabs-preview, check for existing tables first —
   `SELECT column_name FROM information_schema.columns WHERE table_name IN
   ('n8n_alert_claims','n8n_alert_deliveries')`. If rows return, compare the
   column set to `ddl.sql` before applying (IF NOT EXISTS will NOT reconcile
   a divergent schema). Then run `ddl.sql` on **litlabs-preview** (Supabase
   SQL editor) — creates `n8n_alert_claims` + `n8n_alert_deliveries` with
   deny-RLS.
3. In staging n8n: create a **Supabase API** credential pointed at
   `litlabs-preview` (URL + service-role key). Do NOT create Gmail/Discord/
   Slack/Stripe credentials — outbound is intentionally unconfigured.
4. Import `workflows/p0-error-handler-staging.json`.
   - Bind its 4 Supabase nodes to the staging credential.
   - Leave `Send Alert Email` disabled.
   - **Activate** the workflow (errorTrigger must be active).
5. Import `workflows/synthetic-failure-probe.json`.
   - **Settings → Error workflow** → select the imported P0 handler
     (or paste its workflow ID into `settings.errorWorkflow`).
   - **Activate** the probe. It uses a **webhook trigger**
     (`POST /webhook/litt-staging-probe`) because n8n error workflows do
     not fire on manual "Execute workflow" runs — only production-mode
     executions invoke the configured error workflow.
6. Inject the failure twice (dedup check):
   ```
   curl -X POST http://localhost:5678/webhook/litt-staging-probe
   curl -X POST http://localhost:5678/webhook/litt-staging-probe
   ```

## Muse ledger-read check

Muse already reads `litlabs-preview` (action_runs/action_events verified).
After step 2, the ledger tables are visible to the service-role path Muse
uses. Verification query for both of us:

```sql
SELECT alert_key, workflow_name, occurred_at
FROM n8n_alert_claims
WHERE workflow_name ILIKE '%STAGING Synthetic%';
```

If Muse cannot see rows here after run 1, STOP — do not proceed to the
second injection until the read path is confirmed.

## PASS / FAIL criteria (maps to the 7 acceptance criteria)

| # | Criterion | Check |
|---|---|---|
| 1 | Staging separate from prod | n8n on localhost:5678; engine DB = local container; app writes only to `litlabs-preview` |
| 2 | Webhook auth repaired | `repair/n8n-webhook-hmac-20261023` — timestamp inside HMAC; `n8n-webhook.test.ts` 8/8 pass (forged-timestamp replay rejected) |
| 3 | Reused P0 handler + ledger | exported unmodified except: email node disabled, creds scrubbed |
| 4 | Outbound disabled | no Gmail/Discord/Slack/Stripe creds; email node disabled; no httpRequest/webhook-out nodes in the handler (audit table above) |
| 5 | Synthetic failure injected | probe `Boom` node throws `litt-staging-probe synthetic failure litt-staging-probe-001` on the webhook POST |
| 6 | Exactly-once + explanation | `n8n_alert_claims` → exactly 1 row for the probe after BOTH POSTs; `n8n_alert_deliveries` → 1 row (`status='failed'` — truthful, no channel configured); Normalize Error output = normalized explanation |
| 7 | Logs + verdict | Expected executions: probe = error ×2; P0 handler run 1 = **error** (`Fail Loudly` throws by design — a stubbed channel is an undelivered alert, and the handler deliberately refuses to record that as success); run 2 = **success** via `Duplicate — Stop` |

**Traced behavior with Gmail disabled:** the disabled node passes input
through unchanged → `Confirm Fallback` sees no message `id` →
`fallback_confirmed=false` → `Email Delivered?` false → `Record Failed
Delivery` writes `status='failed'` → `Fail Loudly` throws. The ledger is
exactly-once and honest; the handler's error status on run 1 is the
*designed* signal, not a test failure.

**Known benign quirk:** `Resolve Delivery Record` references
`$('Confirm Delivery')` — a removed Discord confirm node. Guarded by
try/catch; resolves to null and falls back to the email path. Harmless in
staging; flag for prod cleanup.

**FAIL conditions:** >1 claim row per alert_key, missing `status='failed'`
delivery row, any write to prod tables, any outbound send attempt, probe
returns success, or P0 handler errors *outside* the expected run-1
`Fail Loudly` (undelivered-alert) path.

## Teardown

`docker compose down -v` — removes containers, volumes, and all staging
engine data. Test rows in `litlabs-preview` can be removed with:

```sql
DELETE FROM n8n_alert_deliveries WHERE alert_key IN
  (SELECT alert_key FROM n8n_alert_claims WHERE workflow_name ILIKE '%STAGING%');
DELETE FROM n8n_alert_claims WHERE workflow_name ILIKE '%STAGING%';
```
