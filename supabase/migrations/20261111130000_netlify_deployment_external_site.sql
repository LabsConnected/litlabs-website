-- ============================================================
-- Netlify publish target: remember the external site per deployment.
--
-- user_project_deployments.target already anticipates additional
-- adapters ('litt-static' today; 'netlify' rows publish to the user's
-- own Netlify account). A Netlify deployment needs the Netlify site id
-- persisted on the record so a re-deploy updates the SAME site instead
-- of creating a new one; the URL alone cannot recover the id.
--
-- Nullable and additive: LiTT Hosting rows leave it null. The
-- deployment store tolerates the column being absent (create retries
-- without it), so code and migration can land in either order.
-- ============================================================

ALTER TABLE public.user_project_deployments
  ADD COLUMN IF NOT EXISTS external_site_id text;
