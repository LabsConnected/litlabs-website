-- GHL Affiliate Tracking — server-side idempotency marker.
--
-- Adds a `ghl_lead_tracked` column to the users table so we can record
-- exactly once per Clerk user whether a GHL affiliate lead has been
-- submitted for them. This replaces the client-side sessionStorage flag
-- which only deduped within a single browser session.
--
-- The marker is set AFTER GHL acknowledges the lead, so a failed
-- trackLead call can be retried on a subsequent visit.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ghl_lead_tracked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ghl_am_id TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ghl_lead_tracked_at TIMESTAMPTZ;

-- Index for querying untracked users (for retries / audits)
CREATE INDEX IF NOT EXISTS idx_users_ghl_lead_untracked
  ON public.users(ghl_lead_tracked) WHERE ghl_lead_tracked = FALSE;
