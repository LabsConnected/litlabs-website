-- ============================================
-- Funnel analytics events table.
--
-- Tracks the user journey from homepage prompt to deployment completion.
-- Used to measure conversion at each stage of the funnel.
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  user_id text,
  anonymous_id text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS analytics_events_event_name_idx
  ON public.analytics_events (event_name);
CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx
  ON public.analytics_events (user_id);
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
  ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_anonymous_id_idx
  ON public.analytics_events (anonymous_id);

-- RLS: service role only (events are tracked server-side)
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

COMMIT;
