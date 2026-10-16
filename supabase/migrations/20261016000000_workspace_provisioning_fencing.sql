-- Workspace provisioning fencing
--
-- A provisioning row is a lease, not merely a status. The opaque token is
-- replaced atomically on every claim and is required by heartbeat and final
-- ready/failed writes. A worker that was reclaimed after a process crash can
-- therefore never overwrite the newer owner's state.
--
-- Rollback (only before deploying code that depends on this column):
--   ALTER TABLE public.studio_projects
--     DROP COLUMN IF EXISTS workspace_provisioning_token;
-- Do not run the rollback after fenced workers are deployed without first
-- rolling code back; old workers would lose their ownership guard.

BEGIN;

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS workspace_provisioning_token UUID;

COMMENT ON COLUMN public.studio_projects.workspace_provisioning_token IS
  'Fencing token for the current workspace provisioning attempt; replaced on claim and cleared on terminal transition.';

COMMIT;
