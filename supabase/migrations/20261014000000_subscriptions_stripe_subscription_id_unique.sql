-- One Stripe subscription belongs to one local row.
-- NULL subscription ids stay allowed (one-time Founder rows have none):
-- Postgres unique indexes treat NULLs as distinct.
-- The webhook upserts on user_id (the existing unique key). This index
-- stops a second user from being attached to the same subscription id;
-- it is not the ON CONFLICT target.
--
-- Do not apply this file to a hosted database from automation.
-- Before a human applies it, confirm there are no duplicate ids:
--   SELECT stripe_subscription_id, count(*)
--   FROM public.subscriptions
--   WHERE stripe_subscription_id IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_uidx
  ON public.subscriptions (stripe_subscription_id);
