# n8n Workflow 06 — Repository / Production Drift

**Date:** 2026-10-07
**Status:** Documented, awaiting reconciliation
**Phase 2:** OPEN

## Summary

The repository definition of n8n workflow 06 ("LiTTree — Failure Alerts") does not
match the live workflow running in n8n production. The repository version is
stale and references infrastructure that does not exist.

## Repository Version (stale)

**File:** `n8n/workflows/06-failure-alerts.json` (archived as `06-failure-alerts.json.archived`)

- **Trigger:** Schedule — every 5 minutes (`*/5 * * * *`)
- **Nodes (8):**
  1. Every 5 Minutes (scheduleTrigger)
  2. Watch Failed Workflows → Supabase `workflow_failures`
  3. Watch Provider Errors → Supabase `provider_errors`
  4. Merge & Redact Secrets (function)
  5. Has Failures? (if)
  6. Create System Event → Supabase `system_events`
  7. Notify Owner via Gmail
  8. Notify Owner via Discord
- **Problem:** Tables `workflow_failures`, `provider_errors`, and `system_events`
  do not exist in the Supabase `public` schema (verified 2026-10-07 via API).
  If this version were active, it would fail at step 2 on every run.

## Live Version (operational baseline)

**n8n instance:** https://n8n.litlabs.net
**Verified:** 2026-10-07 via browser inspection (read-only)

- **Status:** ACTIVE (Published)
- **Trigger:** On Error (n8n error trigger — fires when a workflow with this
  error handler runs and fails)
- **Nodes (2):**
  1. On Error (errorTrigger)
  2. Alert Larry (Gmail)
- **Last execution:** Succeeded, Oct 7 16:33:38 EDT (561ms)
- **No Supabase nodes.** No broken references.

## Discrepancy

| Aspect | Repository | Live |
|--------|-----------|------|
| Trigger | Schedule (5 min) | On Error |
| Supabase nodes | 3 (all broken) | 0 |
| Purpose | Proactive polling | Reactive error handling |
| Status | Stale | Operational |

## Decision

The **live 2-node error handler** is the operational baseline. The repository's
8-node version is archived, not deleted, to preserve history.

## Implications

1. **No proactive failure detection exists.** The live workflow only fires when
   a workflow runs and fails. Silent outages (no executions, n8n down, provider
   unreachable) are not detected.
2. **Overnight gap:** 12–6 AM ET has no verified monitoring coverage.
3. **The stale repo version must not be deployed** — it would break immediately.

## Next Steps (require separate approval)

- Gate 2: Extend existing heartbeat cron with proactive checks
- Gate 3: Isolated alert delivery test
- Gate 4: 7-night monitoring proof

---
*Phase 2 remains OPEN until monitoring is operational and verified.*
