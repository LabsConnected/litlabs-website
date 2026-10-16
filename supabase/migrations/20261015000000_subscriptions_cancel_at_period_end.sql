-- Store Stripe's cancel-at-period-end flag. current_period_end already
-- exists on public.subscriptions; ADD COLUMN IF NOT EXISTS keeps this
-- migration safe if that column is already present.
--
-- RLS is unchanged. Client access stays denied by the existing
-- subscriptions policy. No new policy is created.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
