# n8n Staging Runbook — Isolated Failure-Loop Proof

Proves one complete automation loop (detect → dedup → record → explain)
against **staging only**. Production and billing holds remain in effect.

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
- Generated secrets in `n8n/staging/.env` (never committed):
  ```
  N8N_STAGING_ENCRYPTION_KEY=<openssl rand -hex 32>
  N8N_STAGING_BASIC_AUTH_PASSWORD=<openssl rand -base64 18>
  ```
- litlabs-preview service-role key (from Supabase dashboard — pasted only
  into the staging n8n credential vault, never into files)

## Steps

1. `cd n8n/staging && docker compose up -d` → open http://localhost:5678
2. Run `ddl.sql` on **litlabs-preview** (Supabase SQL editor) — creates
   `n8n_alert_claims` + `n8n_alert_deliveries` with deny-RLS.
3. In staging n8n: create a **Supabase API** credential pointed at
   `litlabs-preview` (URL + service-role key). Do NOT create Gmail/Discord/
   Slack/Stripe credentials — outbound is intentionally unconfigured.
4. Import `workflows/p0-error-handler-staging.json`.
   - Bind its Supabase nodes to the staging credential.
   - `Send Alert Email` is pre-disabled — leave it disabled.
   - Activate the workflow (errorTrigger must be active to catch errors).
5. Import `workflows/synthetic-failure-probe.json`.
   - Set its **Settings → Error workflow** to the imported P0 handler
     (or paste the handler's workflow ID into `settings.errorWorkflow`).
6. Run the probe manually **twice** (same `test_id`) — validates dedup:
   run 1 inserts the claim; run 2 hits the PK conflict and is suppressed.

## PASS / FAIL criteria (maps to the 7 acceptance criteria)

| # | Criterion | Check |
|---|---|---|
| 1 | Staging separate from prod | n8n on localhost:5678; engine DB = local container; app writes only to `litlabs-preview` |
| 2 | Webhook auth repaired | `repair/n8n-webhook-hmac-20261023` branch — timestamp inside HMAC; `n8n-webhook.test.ts` 8/8 pass (forged-timestamp replay rejected) |
| 3 | Reused P0 handler + ledger | imported unmodified except disabled email node + scrubbed creds |
| 4 | Outbound disabled | no Gmail/Discord/Slack/Stripe creds exist; email node disabled; no HTTP to external endpoints |
| 5 | Synthetic failure injected | probe throws `litt-staging-probe synthetic failure litt-staging-probe-001` |
| 6 | Exactly-once + explanation | `SELECT * FROM n8n_alert_claims WHERE workflow_name ILIKE '%STAGING Synthetic%'` → exactly 1 row after 2 runs; `n8n_alert_deliveries` → 1 row for that `alert_key`; Normalize Error output = normalized explanation |
| 7 | Logs + verdict | staging n8n Executions list shows: probe=error (×2), P0 handler=success; export screenshots/JSON for review |

**FAIL conditions:** >1 claim row per alert_key, any row in prod tables,
any outbound send attempt, probe succeeds, or P0 handler errors.

## Teardown

`docker compose down -v` — removes containers, volumes, and all staging
engine data. Nothing persists outside `litlabs-preview` test rows, which
can be removed with `DELETE FROM n8n_alert_deliveries/claims WHERE
alert_key IN (SELECT alert_key FROM n8n_alert_claims WHERE workflow_name
ILIKE '%STAGING%')`.
