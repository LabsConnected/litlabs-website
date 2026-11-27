-- P0 R5 (execution integrity, 2026-11-26): a paused run records the
-- run's ONE stable logical identity, so the identity survives the
-- approval pause (audit D7 — billing run, action run, paused run, and
-- metering run were separate ids, and the resumed segment started a
-- new observability record because the original identity was not
-- persisted across pauses):
--   logical_run_id — the initial segment's metering run id (in
--              production, the billing agent run id the route threads
--              through the metering context). The approvals route
--              passes it into the resume; the resumed segment adopts
--              it as its metering identity and continues the SAME
--              observability record instead of a ":resume" offshoot.
-- Absent (NULL) means a legacy paused run created before this column:
-- its resume derives a segment-local identity exactly as before, and
-- the identity stabilizes from the first R5-aware pause onward.
-- Additive only: one nullable column, no type or policy changes, safe
-- to re-run (the upgrade validator re-runs the whole chain). The code
-- degrades safely before this migration is applied (the insert drops
-- the column and retries), so deployment order is code-first safe.
alter table public.agent_paused_runs
  add column if not exists logical_run_id text;

comment on column public.agent_paused_runs.logical_run_id is
  'P0 R5: the run''s stable logical identity across pause/resume segments; correlates billing/action/paused/metering records. NULL = legacy row, segment-local identity';
