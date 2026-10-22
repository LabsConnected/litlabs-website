-- Studio project creation idempotency key
--
-- Every "New project" submission carries one unique client-generated key.
-- A retried submission reuses its key and is served the row it already
-- made; different submissions always carry different keys, so unrelated
-- projects can never coalesce just because a name or slug matches.
--
-- Uniqueness is enforced at the database level, scoped by user, and only
-- for rows that carry a key — programmatic creates (canvas promotion,
-- agent tools, conversation auto-create) pass no key and are unaffected.
-- Deletes are hard deletes, so a deleted project frees its key and a
-- genuine new submission may create fresh.
--
-- Rollback (only before deploying code that depends on this column):
--   DROP INDEX IF EXISTS studio_projects_idempotency_key_uq;
--   ALTER TABLE public.studio_projects
--     DROP COLUMN IF EXISTS idempotency_key;

BEGIN;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.studio_projects.idempotency_key IS
  'Client-generated create-submission key; unique per user for idempotent POST /api/studio-projects retries.';

CREATE UNIQUE INDEX IF NOT EXISTS studio_projects_idempotency_key_uq
  ON public.studio_projects(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
