-- GHL Affiliate Tracking — server-side idempotency with atomic claim.
--
-- Replaces the simple boolean `ghl_lead_tracked` with a state machine:
--   untracked → processing → tracked | failed
--
-- The atomic claim (conditional UPDATE ... WHERE state = 'untracked')
-- ensures that only ONE concurrent request can transition to `processing`
-- and call GHL. All other concurrent requests see `processing` and
-- return early as in-progress/replayed.
--
-- `ghl_tracking_started_at` records when `processing` began so a
-- crashed/stuck record can be recovered (reset to `untracked`) after
-- a stale timeout (default 5 minutes).

-- Add the state column (defaults to 'untracked')
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ghl_tracking_state TEXT NOT NULL DEFAULT 'untracked';

-- Backfill: any user previously marked as tracked gets state='tracked'
UPDATE public.users
  SET ghl_tracking_state = 'tracked'
  WHERE ghl_lead_tracked = TRUE;

-- Add the processing-started timestamp for stale recovery
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ghl_tracking_started_at TIMESTAMPTZ;

-- Index for the atomic claim query:
--   UPDATE ... SET state='processing' WHERE clerk_id=? AND state='untracked'
-- This index makes the conditional update fast and safe.
CREATE INDEX IF NOT EXISTS idx_users_ghl_tracking_state
  ON public.users(clerk_id, ghl_tracking_state);

-- Index for stale-processing recovery scans
CREATE INDEX IF NOT EXISTS idx_users_ghl_stale_processing
  ON public.users(ghl_tracking_started_at)
  WHERE ghl_tracking_state = 'processing';

-- The original ghl_lead_tracked column is kept for backward compat.
-- ghl_tracking_state = 'tracked' is the source of truth going forward.
-- A future migration can drop ghl_lead_tracked once all code uses state.
