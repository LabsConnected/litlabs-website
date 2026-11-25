-- Studio project topic pack
--
-- Topic packs (TOPIC-PACKS-SPEC-2026-11-19 §4.2.4): the pack selected
-- for a project's site is stored on the project record so later edits,
-- added pages, and regenerations keep using the same pack instead of
-- re-guessing the topic. The value is a pack id from the in-app
-- registry (e.g. 'roofing'); NULL means no pack attached.
--
-- The column is additive and nullable. Code reads it through an
-- optional row field, so a pre-migration database simply reports "no
-- pack stored" — the same pattern as workspace_branch (20260915020000)
-- and idempotency_key (20261018000000).
--
-- Rollback (only before deploying code that depends on this column):
--   ALTER TABLE public.studio_projects DROP COLUMN IF EXISTS topic_pack_id;

BEGIN;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS topic_pack_id text;

COMMENT ON COLUMN public.studio_projects.topic_pack_id IS
  'Topic pack id selected for this project''s site (registry id from src/lib/litt-intelligence/topic-packs); NULL = no pack.';

COMMIT;
