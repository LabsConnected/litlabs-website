-- P0 R1 (execution integrity, 2026-11-26): a paused run records the
-- outcome of its workspace-checkpoint creation. When creation was
-- attempted for the run's baseline and FAILED, the loop stores the
-- transport's error here instead of swallowing it to a silent null
-- checkpointId:
--   checkpoint_failure — the creation error (sanitized transport
--              message). A resume MUST refuse a run carrying this:
--              there is no verified baseline to continue from.
-- Absent (NULL) means no failed attempt was recorded: the checkpoint
-- was created (checkpoint_id set), never attempted (read-only gate),
-- or not applicable (static/gitless workspace — creation returns null
-- WITHOUT an error there by design). Legacy rows read as NULL, which
-- keeps their pre-R1 resume behavior.
-- Additive only: one nullable column, no type or policy changes, safe
-- to re-run (the upgrade validator re-runs the whole chain).
alter table public.agent_paused_runs
  add column if not exists checkpoint_failure text;

comment on column public.agent_paused_runs.checkpoint_failure is
  'P0 R1: workspace-checkpoint creation error recorded at pause time; a resume must refuse a run carrying it (no verified baseline). NULL = no failed attempt recorded';
