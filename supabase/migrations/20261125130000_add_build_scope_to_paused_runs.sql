-- ACC-07: one approval covers the entire scoped build (Larry's ruling,
-- 2026-11-25). The paused-run record carries the run's build-scope state
-- across its own approval pauses:
--   { "grants": boolean, "authorized": boolean }
-- grants     — approving THIS gate grants the build scope (the gate is the
--              run's first build-scope call; its card shows the scope text).
-- authorized — the run already held build scope when it paused here (e.g.
--              a deploy gate mid-build), so the scope survives the pause.
-- Absent on legacy rows and before this migration is applied; readers treat
-- absence as "no scope", which is the pre-ACC-07 behavior.
alter table public.agent_paused_runs
  add column if not exists build_scope jsonb;

comment on column public.agent_paused_runs.build_scope is
  'ACC-07 build-scope state for the paused run: {grants, authorized} — one approval covers the scoped build (files/images/media); publishing, destructive and out-of-scope actions still gate separately';
