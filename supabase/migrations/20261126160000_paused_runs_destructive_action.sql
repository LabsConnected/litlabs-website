-- P0 R6 (execution integrity, 2026-11-26): a paused run whose gate is
-- a destructive action records the approval-card data contract, so
-- the card the user decides on can render the founder's standard —
-- named target, operation, dependency check, BLOCKED status, and
-- available actions (origin: Acceptance Run 1 restart, 2026-11-26 —
-- four files.delete approvals named no target, and three approved
-- deletes removed images the homepage referenced):
--   destructive_action — the DestructiveActionAssessment JSON built
--              at gate time (destructive-action.ts): toolId, operation,
--              target, reason, dependencies, blocked, consequences,
--              recovery, availableActions, gateStreak.
-- Absent (NULL) means the gate was not a destructive action, or a
-- legacy paused run created before this column.
-- Additive only: one nullable column, no type or policy changes, safe
-- to re-run (the upgrade validator re-runs the whole chain). The code
-- degrades safely before this migration is applied (the insert drops
-- the column and retries), so deployment order is code-first safe.
alter table public.agent_paused_runs
  add column if not exists destructive_action jsonb;

comment on column public.agent_paused_runs.destructive_action is
  'P0 R6: destructive-action approval card data (target, dependencies, blocked status, actions) for the gate that created this paused run. NULL = not a destructive gate, or legacy row';
