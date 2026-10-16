-- A second paid Stripe subscription must not replace the one already stored.
-- The webhook inserts a row here and leaves the existing subscription in place.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.billing_subscription_conflicts;

CREATE TABLE IF NOT EXISTS public.billing_subscription_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  existing_subscription_id text NOT NULL,
  incoming_subscription_id text NOT NULL,
  stripe_event_id text NOT NULL,
  event_type text NOT NULL,
  incoming_plan text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_event_id, incoming_subscription_id)
);

ALTER TABLE public.billing_subscription_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_billing_subscription_conflicts
  ON public.billing_subscription_conflicts;
CREATE POLICY service_role_all_billing_subscription_conflicts
  ON public.billing_subscription_conflicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.billing_subscription_conflicts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.billing_subscription_conflicts TO service_role;
