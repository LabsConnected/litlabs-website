-- api-table-grants.sql — E2E-ISOLATED disposable stack only. NEVER a migration.
--
-- Why this exists: `supabase start` applies this schema's migrations under
-- the migrator role without the default-privilege grants the stock local
-- stack normally applies, so PostgREST roles hit 42501 "permission denied
-- for table" — proven on run 40268252752 for `studio_projects`/`projects`,
-- including for service_role.
--
-- Scope is deliberately narrow:
--   * service_role ONLY — every Studio API route resolves through the
--     server-side `supabaseAdmin` client. Specs and Studio components make
--     zero direct PostgREST calls (verified: no `.from()`/`rest/v1` in
--     tests/playwright-e2e/); anon/authenticated get NOTHING here.
--   * Privileges verified per-table against the actual API operations the
--     canvas-builder specs exercise (POST create → project surface load →
--     canvas file sync → DELETE). Read-only grants where only reads occur.
--   * RLS is unchanged: existing service_role_all_* policies already model
--     service access; table GRANTs are the missing layer *below* RLS.
--     Authorization testing stays meaningful — anon remains denied at RLS,
--     auth-gating and off-allowlist tests still exercise real denial, and
--     the RPC EXECUTE lockdown (rpc-exec-lockdown.sql) is untouched.
--
-- Applied via: docker exec supabase_db_LiTTreeLabStudio_E2E psql ... < this file
-- Rollback: disposable DB is destroyed with the container; no cleanup needed.

BEGIN;

-- ── Required by the tested project lifecycle (42501-proven) ───────────────
-- POST /api/studio-projects → createBlankProject: SELECT (idempotency
-- pre-check) + INSERT + SELECT (refresh). after() → provisionWorkspaceForProject:
-- UPDATE workspace_status/*. DELETE route → deleteProject: DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.studio_projects TO service_role;

-- Legacy `projects` table is READ-ONLY in the canonical repository layer
-- (resolveCurrentProject, listProjects, migrate-legacy fallback selects).
GRANT SELECT ON TABLE public.projects TO service_role;

-- ── Active-project persistence — /api/project/active upsert ───────────────
-- The shell persists the ?project= selection on navigation; upsert needs
-- INSERT + UPDATE. SELECT for the read path.
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_active_project TO service_role;

-- ── Conversation bootstrap on project surface mount ───────────────────────
-- conversation-service ensure/create: INSERT + SELECT; revision/project-link
-- bumps: UPDATE. Messages: list + insert (send path not exercised).
GRANT SELECT, INSERT, UPDATE ON TABLE public.studio_conversations TO service_role;
GRANT SELECT, INSERT ON TABLE public.studio_conversation_messages TO service_role;

-- ── Read-only surface fetches (panels shell mounts) ───────────────────────
GRANT SELECT ON TABLE public.studio_tasks TO service_role;        -- tasks panel
GRANT SELECT ON TABLE public.action_runs TO service_role;         -- run status panel
GRANT SELECT ON TABLE public.github_installations TO service_role; -- studio-projects route reads
GRANT SELECT ON TABLE public.memories TO service_role;            -- conversation context reads

COMMIT;

-- Self-check: fail the step if any granted table still lacks service_role
-- SELECT. Mirrors the verify pattern used for the RPC lockdown.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM (VALUES
    ('studio_projects'), ('projects'), ('user_active_project'),
    ('studio_conversations'), ('studio_conversation_messages'),
    ('studio_tasks'), ('action_runs'), ('github_installations'), ('memories')
  ) AS v(t)
  WHERE NOT has_table_privilege('service_role', format('public.%I', v.t), 'SELECT');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'service_role still lacks SELECT on: %', missing;
  END IF;
END $$;
