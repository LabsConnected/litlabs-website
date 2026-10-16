-- Unix seconds of the Stripe event last applied to this subscription.
-- Webhook ordering compares event.created to this column. updated_at is
-- the app wall clock and must not be used for that comparison.
--
-- Nullable. Existing rows stay null until the next applied webhook.
-- RLS is unchanged. No new policy is created.
--
-- Rollback, after the application code that reads this column is reverted:
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS last_stripe_event_created;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_stripe_event_created bigint;
