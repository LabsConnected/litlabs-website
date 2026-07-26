-- Make credit_ledger the single source of truth for LiTBits.
-- Repairs bucket ordering, purchased-credit debits, replay detection, and races.

ALTER TABLE public.credit_ledger
  DROP CONSTRAINT IF EXISTS credit_ledger_amount_positive;
ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_amount_positive CHECK (amount > 0);

CREATE OR REPLACE FUNCTION public.get_user_balances(p_user_id UUID)
RETURNS TABLE(monthly INTEGER, purchased INTEGER, beta_promotional INTEGER, total INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH balances AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE direction = 'credit' AND balance_bucket = 'monthly'), 0)
        - COALESCE(SUM(amount) FILTER (WHERE direction = 'debit' AND balance_bucket = 'monthly'), 0) AS monthly,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'credit' AND balance_bucket = 'purchased'), 0)
        - COALESCE(SUM(amount) FILTER (WHERE direction = 'debit' AND balance_bucket = 'purchased'), 0) AS purchased,
      COALESCE(SUM(amount) FILTER (WHERE direction = 'credit' AND balance_bucket = 'beta_promotional'), 0)
        - COALESCE(SUM(amount) FILTER (WHERE direction = 'debit' AND balance_bucket = 'beta_promotional'), 0) AS beta
    FROM public.credit_ledger
    WHERE user_id = p_user_id
      AND (expires_at IS NULL OR expires_at > now())
  )
  SELECT
    GREATEST(monthly, 0)::INTEGER,
    GREATEST(purchased, 0)::INTEGER,
    GREATEST(beta, 0)::INTEGER,
    (GREATEST(monthly, 0) + GREATEST(purchased, 0) + GREATEST(beta, 0))::INTEGER
  FROM balances;
$$;

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
  v_monthly INTEGER;
  v_purchased INTEGER;
  v_beta INTEGER;
  v_total INTEGER;
  v_left INTEGER;
  v_take INTEGER;
  v_monthly_expires TIMESTAMPTZ;
BEGIN
  IF p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Debit amount must be between 1 and 1000000';
  END IF;
  IF p_category NOT IN ('usage', 'refund', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid debit category';
  END IF;
  IF length(trim(p_description)) < 3 OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'Description and idempotency key are required';
  END IF;

  -- Serialize balance mutations per user.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  IF EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id
      AND idempotency_key LIKE p_idempotency_key || ':%'
  ) THEN
    SELECT b.total INTO v_total FROM public.get_user_balances(p_user_id) b;
    RETURN QUERY SELECT true, v_total;
    RETURN;
  END IF;

  SELECT b.monthly, b.purchased, b.beta_promotional, b.total
  INTO v_monthly, v_purchased, v_beta, v_total
  FROM public.get_user_balances(p_user_id) b;

  IF v_total < p_amount THEN
    RETURN QUERY SELECT false, v_total;
    RETURN;
  END IF;

  v_left := p_amount;

  v_take := LEAST(v_monthly, v_left);
  IF v_take > 0 THEN
    SELECT min(expires_at) INTO v_monthly_expires
    FROM public.credit_ledger
    WHERE user_id = p_user_id
      AND direction = 'credit'
      AND balance_bucket = 'monthly'
      AND (expires_at IS NULL OR expires_at > now());
    INSERT INTO public.credit_ledger
      (user_id, amount, direction, category, balance_bucket, description, idempotency_key, expires_at)
    VALUES
      (p_user_id, v_take, 'debit', p_category, 'monthly', trim(p_description), p_idempotency_key || ':monthly', v_monthly_expires);
    v_left := v_left - v_take;
  END IF;

  -- Promotional credits are consumed before purchased credits.
  v_take := LEAST(v_beta, v_left);
  IF v_take > 0 THEN
    INSERT INTO public.credit_ledger
      (user_id, amount, direction, category, balance_bucket, description, idempotency_key)
    VALUES
      (p_user_id, v_take, 'debit', p_category, 'beta_promotional', trim(p_description), p_idempotency_key || ':beta');
    v_left := v_left - v_take;
  END IF;

  v_take := LEAST(v_purchased, v_left);
  IF v_take > 0 THEN
    INSERT INTO public.credit_ledger
      (user_id, amount, direction, category, balance_bucket, description, idempotency_key)
    VALUES
      (p_user_id, v_take, 'debit', p_category, 'purchased', trim(p_description), p_idempotency_key || ':purchased');
    v_left := v_left - v_take;
  END IF;

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'Credit debit allocation failed';
  END IF;

  SELECT b.total INTO v_total FROM public.get_user_balances(p_user_id) b;
  RETURN QUERY SELECT true, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_balances(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_balances(UUID) TO service_role;

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
  v_total INTEGER;
BEGIN
  IF p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'Grant amount must be between 1 and 1000000';
  END IF;
  IF p_category NOT IN ('subscription_grant', 'beta_grant', 'purchase', 'refund', 'adjustment', 'promotion') THEN
    RAISE EXCEPTION 'Invalid grant category';
  END IF;
  IF p_balance_bucket NOT IN ('monthly', 'purchased', 'beta_promotional') THEN
    RAISE EXCEPTION 'Invalid balance bucket';
  END IF;
  IF length(trim(p_description)) < 3 OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'Description and idempotency key are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  IF EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT b.total INTO v_total FROM public.get_user_balances(p_user_id) b;
    RETURN QUERY SELECT false, v_total;
    RETURN;
  END IF;

  INSERT INTO public.credit_ledger (
    user_id, amount, direction, category, balance_bucket, description,
    idempotency_key, reference_type, reference_id, expires_at
  ) VALUES (
    p_user_id, p_amount, 'credit', p_category, p_balance_bucket, trim(p_description),
    trim(p_idempotency_key), p_reference_type, p_reference_id, p_expires_at
  );

  SELECT b.total INTO v_total FROM public.get_user_balances(p_user_id) b;
  RETURN QUERY SELECT true, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.debit_credits(UUID, INTEGER, TEXT, TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credits(UUID, INTEGER, TEXT, TEXT, TEXT) TO service_role;

-- Preserve legacy balances exactly once as non-cash beta promotional credits.
INSERT INTO public.credit_ledger (
  user_id, amount, direction, category, balance_bucket,
  description, idempotency_key, reference_type, reference_id
)
SELECT
  w.user_id,
  w.balance,
  'credit',
  'beta_grant',
  'beta_promotional',
  'Legacy LiTBits balance migrated to unified ledger',
  'legacy-wallet:' || w.user_id::TEXT,
  'wallet_migration',
  w.user_id::TEXT
FROM public.wallets w
WHERE w.balance > 0
ON CONFLICT (idempotency_key) DO NOTHING;
