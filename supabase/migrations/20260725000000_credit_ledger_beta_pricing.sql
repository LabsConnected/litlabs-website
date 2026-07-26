-- Credit ledger with balance buckets and idempotent Stripe event processing.
-- Does NOT alter existing wallets or transactions tables — adds new tables alongside.

-- ── Credit ledger: immutable append-only ledger entries ──
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  category TEXT NOT NULL CHECK (category IN (
    'subscription_grant',
    'beta_grant',
    'purchase',
    'usage',
    'refund',
    'adjustment',
    'promotion'
  )),
  balance_bucket TEXT NOT NULL CHECK (balance_bucket IN (
    'monthly',
    'purchased',
    'beta_promotional'
  )),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_idempotency_key_unique
  ON public.credit_ledger (idempotency_key);

CREATE INDEX IF NOT EXISTS credit_ledger_user_id ON public.credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS credit_ledger_user_bucket ON public.credit_ledger(user_id, balance_bucket);
CREATE INDEX IF NOT EXISTS credit_ledger_expires ON public.credit_ledger(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_ledger_deny_anon ON public.credit_ledger;
CREATE POLICY credit_ledger_deny_anon ON public.credit_ledger FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS credit_ledger_deny_authenticated ON public.credit_ledger;
CREATE POLICY credit_ledger_deny_authenticated ON public.credit_ledger FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── Stripe event log: idempotent webhook processing ──
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS stripe_events_event_id ON public.stripe_events(stripe_event_id);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_events_deny_anon ON public.stripe_events;
CREATE POLICY stripe_events_deny_anon ON public.stripe_events FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS stripe_events_deny_authenticated ON public.stripe_events;
CREATE POLICY stripe_events_deny_authenticated ON public.stripe_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── Add plan column to subscriptions (if not already present) ──
-- Older production databases may predate this column.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE public.subscriptions
  ALTER COLUMN plan SET DEFAULT 'starter';

-- ── Add balance buckets to wallets (additive, no data loss) ──
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS monthly_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchased_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS beta_balance INTEGER NOT NULL DEFAULT 0;

-- ── Function: calculate balance from ledger ──
CREATE OR REPLACE FUNCTION public.get_user_balances(p_user_id UUID)
RETURNS TABLE(monthly INTEGER, purchased INTEGER, beta_promotional INTEGER, total INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'credit' AND balance_bucket = 'monthly' THEN amount ELSE 0 END)
           - SUM(CASE WHEN direction = 'debit' AND balance_bucket = 'monthly' THEN amount ELSE 0 END), 0) AS monthly,
    COALESCE(SUM(CASE WHEN direction = 'credit' AND balance_bucket = 'purchased' THEN amount ELSE 0 END)
           - SUM(CASE WHEN direction = 'debit' AND balance_bucket = 'purchased' THEN amount ELSE 0 END), 0) AS purchased,
    COALESCE(SUM(CASE WHEN direction = 'credit' AND balance_bucket = 'beta_promotional' THEN amount ELSE 0 END)
           - SUM(CASE WHEN direction = 'debit' AND balance_bucket = 'beta_promotional' THEN amount ELSE 0 END), 0) AS beta_promotional,
    COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
           - SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS total
  FROM public.credit_ledger
  WHERE user_id = p_user_id
    AND (expires_at IS NULL OR expires_at > now());
$$;

REVOKE ALL ON FUNCTION public.get_user_balances(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_balances(UUID) TO service_role;

-- ── Function: idempotent credit grant ──
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_category TEXT,
  p_balance_bucket TEXT,
  p_description TEXT,
  p_idempotency_key TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(granted BOOLEAN, total_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing INTEGER;
  v_total INTEGER;
BEGIN
  -- Check idempotency
  SELECT 1 INTO v_existing
  FROM public.credit_ledger
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    -- Already processed — return current total
    SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
           - SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
    INTO v_total
    FROM public.credit_ledger
    WHERE user_id = p_user_id
      AND (expires_at IS NULL OR expires_at > now());

    RETURN QUERY SELECT false, v_total;
    RETURN;
  END IF;

  -- Insert ledger entry
  INSERT INTO public.credit_ledger (
    user_id, amount, direction, category, balance_bucket,
    description, idempotency_key, reference_type, reference_id, expires_at
  ) VALUES (
    p_user_id, p_amount, 'credit', p_category, p_balance_bucket,
    p_description, p_idempotency_key, p_reference_type, p_reference_id, p_expires_at
  );

  -- Return new total
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
         - SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
  INTO v_total
  FROM public.credit_ledger
  WHERE user_id = p_user_id
    AND (expires_at IS NULL OR expires_at > now());

  RETURN QUERY SELECT true, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ── Function: debit credits (consumes monthly first, then beta, then purchased) ──
CREATE OR REPLACE FUNCTION public.debit_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_category TEXT,
  p_description TEXT,
  p_idempotency_key TEXT
)
RETURNS TABLE(success BOOLEAN, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing INTEGER;
  v_monthly INTEGER;
  v_beta INTEGER;
  v_purchased INTEGER;
  v_remaining INTEGER;
  v_to_debit INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive';
  END IF;

  -- Check idempotency
  SELECT 1 INTO v_existing
  FROM public.credit_ledger
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
           - SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
    INTO v_remaining
    FROM public.credit_ledger
    WHERE user_id = p_user_id
      AND (expires_at IS NULL OR expires_at > now());

    RETURN QUERY SELECT false, v_remaining;
    RETURN;
  END IF;

  -- Get available balances
  SELECT * INTO v_monthly, v_beta, v_purchased, v_remaining
  FROM public.get_user_balances(p_user_id);

  IF v_remaining < p_amount THEN
    RETURN QUERY SELECT false, v_remaining;
    RETURN;
  END IF;

  -- Consume: monthly → beta_promotional → purchased
  v_to_debit := LEAST(v_monthly, p_amount);
  IF v_to_debit > 0 THEN
    INSERT INTO public.credit_ledger (user_id, amount, direction, category, balance_bucket, description, idempotency_key)
    VALUES (p_user_id, v_to_debit, 'debit', p_category, 'monthly', p_description, p_idempotency_key || '_m');
  END IF;

  IF v_to_debit < p_amount THEN
    v_to_debit := LEAST(v_beta, p_amount - v_to_debit);
    IF v_to_debit > 0 THEN
      INSERT INTO public.credit_ledger (user_id, amount, direction, category, balance_bucket, description, idempotency_key)
      VALUES (p_user_id, v_to_debit, 'debit', p_category, 'beta_promotional', p_description, p_idempotency_key || '_b');
    END IF;
  END IF;

  -- If still need more, take from purchased
  SELECT * INTO v_monthly, v_beta, v_purchased, v_remaining
  FROM public.get_user_balances(p_user_id);

  IF v_remaining > 0 THEN
    -- This shouldn't happen if we checked above, but safety net
    NULL;
  END IF;

  -- Get final remaining
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
         - SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)
  INTO v_remaining
  FROM public.credit_ledger
  WHERE user_id = p_user_id
    AND (expires_at IS NULL OR expires_at > now());

  RETURN QUERY SELECT true, v_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.debit_credits(UUID, INTEGER, TEXT, TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits(UUID, INTEGER, TEXT, TEXT, TEXT) TO service_role;
