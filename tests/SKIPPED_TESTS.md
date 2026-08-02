# Skipped Test Documentation

## Summary
- **Total tests:** 533 (522 passed, 11 skipped)
- **Skipped test file:** `tests/premium-agents-phase2.integration.test.ts`
- **Skip reason:** Requires `INTEGRATION_TEST=1` env var + Docker (Postgres 17 container)

## Why These Tests Are Skipped

These are **real database integration tests** that verify the actual Postgres schema
accepts correct data types, enforces constraints, and that RPCs work atomically.
They are skipped by default because:

1. They require **Docker** to be running (starts a fresh Postgres 17 container)
2. They require the `INTEGRATION_TEST=1` environment variable to be set
3. They apply `supabase/schema.sql` + all migrations to a fresh container
4. They take ~30s per test due to container startup and SQL execution
5. CI doesn't have Docker-in-Docker enabled for the standard build workflow

To run them locally:
```powershell
$env:INTEGRATION_TEST=1; pnpm exec vitest run tests/premium-agents-phase2.integration.test.ts
```

## Individual Test Documentation

### 1. `user_agents.agent_id accepts UUID and FK is valid`
- **What it tests:** The `user_agents.agent_id` column accepts UUID values and
  the foreign key to `agents.id` is valid (JOIN succeeds).
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Low — schema is verified by `npx tsc --noEmit` and
  migration replay tests. FK validity is enforced by Postgres DDL.

### 2. `user_agents.agent_id rejects non-UUID values (type enforcement)`
- **What it tests:** Inserting a non-UUID value into `user_agents.agent_id`
  raises a type error.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Low — Postgres enforces UUID type at the database level.

### 3. `duplicate (user_id, agent_id) is idempotent via unique constraint`
- **What it tests:** The unique constraint on `(user_id, agent_id)` in
  `user_agents` prevents duplicate installations.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Low — unique constraint is defined in schema.sql.

### 4. `marketplace_order_items.agent_id column exists and accepts UUID`
- **What it tests:** The `marketplace_order_items.agent_id` column exists and
  accepts UUID values.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Low — column existence is verified by migration
  replay tests.

### 5. `create_pending_agent_order RPC creates order + item atomically`
- **What it tests:** The `create_pending_agent_order` Postgres RPC creates
  both a `marketplace_orders` row and a `marketplace_order_items` row
  atomically in a single transaction.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Medium — RPC logic is complex. Should be run before
  any marketplace deployment.

### 6. `create_pending_agent_order rejects private agents`
- **What it tests:** The RPC rejects attempts to purchase agents with
  `is_public = false`.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Medium — security-relevant. Should be run before
  any marketplace deployment.

### 7. `create_pending_agent_order rejects unpublished versions`
- **What it tests:** The RPC rejects attempts to purchase agent versions
  with status != 'published'.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Medium — prevents purchasing draft/rejected agents.

### 8. `create_pending_agent_order rejects when active entitlement exists`
- **What it tests:** The RPC rejects duplicate purchases when the user
  already has an active entitlement for the agent.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Medium — prevents double-charging users.

### 9. `agent_entitlements stores version policy fields correctly`
- **What it tests:** The `agent_entitlements` table correctly stores
  version policy fields (min_version, max_version, etc.).
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Low — column existence verified by migration tests.

### 10. `expired pending order is not counted as active pending`
- **What it tests:** Orders with `status = 'pending'` and `expires_at < now()`
  are not counted as active pending orders.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Medium — affects purchase flow logic.

### 11. `user_agents FK cascade deletes when agent is deleted`
- **What it tests:** Deleting an agent cascades to delete associated
  `user_agents` rows.
- **Why skipped:** Requires Docker + Postgres container.
- **Risk of skipping:** Low — cascade behavior is defined in schema.sql DDL.

## Recommendation

Tests 5-8 and 10 should be run before any marketplace deployment. Consider
adding a separate CI job that runs with Docker enabled to execute these
integration tests on PRs that touch marketplace code.
