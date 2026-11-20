-- Billing settlement bucket allocation + refund idempotency.
--
-- Root cause fixed here: settle_bits wrote every settlement debit to the
-- 'monthly' bucket regardless of where the reserved BITS actually lived.
-- get_user_balances derives per-bucket balances from credit_ledger and clamps
-- each bucket at zero, so a beta_promotional-funded settlement produced a
-- negative (clamped) monthly bucket while beta_promotional stayed high —
-- get_user_balances reported the pre-settlement total while
-- get_available_balance (raw ledger sum) reported the correct lower total.
--
-- Fix: settle_bits now allocates debits across buckets in the canonical spend
-- order used by debit_credits (monthly -> beta_promotional -> purchased), via
-- the shared allocate_ledger_debit helper. Ledger keys become
-- '<key>:settle:<bucket>' / '<key>:overage:<bucket>'.
--
-- refund_credits is rewritten for durable idempotency: the refund is recorded
-- as a credit_ledger row keyed 'refund_credits:<run_id>' protected by the
-- credit_ledger idempotency unique index plus a per-user advisory lock, so
-- retries and concurrent calls can never double-credit. The legacy
-- users.credits mirror is dropped entirely: the column no longer exists in
-- the current schema, so the old function errored on every call and no
-- refund ever landed anywhere.

-- ─────────────────────────────────────────────────────────────
-- allocate_ledger_debit: spend-ordered bucket allocation helper
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allocate_ledger_debit(
  p_user_id       UUID,
  p_amount        INTEGER,
  p_category      TEXT,
  p_description   TEXT,
  p_key_prefix    TEXT,
  p_reference_type TEXT,
  p_reference_id  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monthly INTEGER;
  v_purchased INTEGER;
  v_beta INTEGER;
  v_left INTEGER;
  v_take INTEGER;
  v_monthly_expires TIMESTAMPTZ;
BEGIN
  IF p_amount <= 0 THEN
    RETURN;
  END IF;

  SELECT b.monthly, b.purchased, b.beta_promotional
  INTO v_monthly, v_purchased, v_beta
  FROM public.get_user_balances(p_user_id) b;

  v_left := p_amount;

  -- Canonical spend order: monthly subscription bits first.
  v_take := LEAST(v_monthly, v_left);
  IF v_take > 0 THEN
    SELECT min(expires_at) INTO v_monthly_expires
    FROM public.credit_ledger
    WHERE user_id = p_user_id
      AND direction = 'credit'
      AND balance_bucket = 'monthly'
      AND (expires_at IS NULL OR expires_at > now());
    INSERT INTO public.credit_ledger
      (user_id, amount, direction, category, balance_bucket, description, idempotency_key, reference_type, reference_id, expires_at)
    VALUES
      (p_user_id, v_take, 'debit', p_category, 'monthly', trim(p_description), p_key_prefix || ':monthly', p_reference_type, p_reference_id, v_monthly_expires);
    v_left := v_left - v_take;
  END IF;

  -- Promotional credits are consumed before purchased credits.
  v_take := LEAST(v_beta, v_left);
  IF v_take > 0 THEN
    INSERT INTO public.credit_ledger
      (user_id, amount, direction, category, balance_bucket, description, idempotency_key, reference_type, reference_id)
    VALUES
      (p_user_id, v_take, 'debit', p_category, 'beta_promotional', trim(p_description), p_key_prefix || ':beta', p_reference_type, p_reference_id);
    v_left := v_left - v_take;
  END IF;

  v_take := LEAST(v_purchased, v_left);
  IF v_take > 0 THEN
    INSERT INTO public.credit_ledger
      (user_id, amount, direction, category, balance_bucket, description, idempotency_key, reference_type, reference_id)
    VALUES
      (p_user_id, v_take, 'debit', p_category, 'purchased', trim(p_description), p_key_prefix || ':purchased', p_reference_type, p_reference_id);
    v_left := v_left - v_take;
  END IF;

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'Credit debit allocation failed: % BITS unallocatable for user %', v_left, p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_ledger_debit(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_ledger_debit(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
ALTER FUNCTION public.allocate_ledger_debit(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT) SET search_path = '';

-- ─────────────────────────────────────────────────────────────
-- settle_bits: bucket-aware settlement debits
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_bits(
  p_reservation_id  UUID,
  p_actual_amount   INTEGER,
  p_idempotency_key TEXT,
  p_overage_policy  TEXT  DEFAULT 'reject',
  p_description     TEXT  DEFAULT NULL
)
RETURNS TABLE(
  success          BOOLEAN,
  settled_amount   INTEGER,
  released_amount  INTEGER,
  available_after  INTEGER,
  reason           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation  public.credit_reservations%ROWTYPE;
  v_available    INTEGER;
  v_settle_amt   INTEGER;
  v_release_amt  INTEGER;
  v_overage      INTEGER;
  v_user_id      UUID;
BEGIN
  -- Validate inputs
  IF p_actual_amount < 0 OR p_actual_amount > 1000000 THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'actual_amount_must_be_0_to_1000000';
    RETURN;
  END IF;
  IF length(trim(p_idempotency_key)) < 8 THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'idempotency_key_min_8_chars';
    RETURN;
  END IF;
  IF p_overage_policy NOT IN ('reject', 'allow') THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'invalid_overage_policy';
    RETURN;
  END IF;

  -- Load the reservation
  SELECT * INTO v_reservation
  FROM public.credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'reservation_not_found';
    RETURN;
  END IF;

  v_user_id := v_reservation.user_id;

  -- Serialize all balance mutations for this user
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  -- Idempotency: if already settled, return the original result
  IF v_reservation.status = 'settled' THEN
    SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
    FROM public.get_available_balance(v_user_id) b;
    RETURN QUERY SELECT true, v_reservation.settled_amount, 0, v_available, 'already_settled';
    RETURN;
  END IF;

  -- Cannot settle a released reservation
  IF v_reservation.status = 'released' THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'reservation_already_released';
    RETURN;
  END IF;

  -- Cannot settle an expired reservation
  IF v_reservation.status = 'expired' OR v_reservation.expires_at <= now() THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'reservation_expired';
    RETURN;
  END IF;

  -- Compute settle and release amounts
  v_settle_amt := LEAST(p_actual_amount, v_reservation.reserved_amount);
  v_release_amt := v_reservation.reserved_amount - v_settle_amt;
  v_overage := GREATEST(p_actual_amount - v_reservation.reserved_amount, 0);

  -- Handle overage
  IF v_overage > 0 THEN
    IF p_overage_policy = 'reject' THEN
      RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'overage_rejected';
      RETURN;
    END IF;

    -- 'allow': check if available balance covers the overage
    SELECT b.available INTO v_available
    FROM public.get_available_balance(v_user_id) b;

    IF v_available < v_overage THEN
      RETURN QUERY SELECT false, 0, 0, v_available, 'overage_insufficient_balance';
      RETURN;
    END IF;
  END IF;

  -- Write the settled amount as bucket-allocated debits to credit_ledger.
  -- Debits drain monthly -> beta_promotional -> purchased so the per-bucket
  -- balances reported by get_user_balances stay consistent with the raw
  -- ledger total reported by get_available_balance.
  IF v_settle_amt > 0 THEN
    PERFORM public.allocate_ledger_debit(
      v_user_id,
      v_settle_amt,
      'usage',
      COALESCE(trim(p_description), v_reservation.description),
      p_idempotency_key || ':settle',
      COALESCE(v_reservation.reference_type, 'reservation'),
      v_reservation.id::TEXT
    );
  END IF;

  -- Write the overage as additional bucket-allocated debits (if allowed)
  IF v_overage > 0 THEN
    PERFORM public.allocate_ledger_debit(
      v_user_id,
      v_overage,
      'usage',
      'Overage for ' || COALESCE(v_reservation.description, 'reservation'),
      p_idempotency_key || ':overage',
      'reservation_overage',
      v_reservation.id::TEXT
    );
  END IF;

  -- Update the reservation
  UPDATE public.credit_reservations
  SET
    status         = 'settled',
    settled_amount = v_settle_amt + v_overage,
    settled_at     = now()
  WHERE id = p_reservation_id;

  -- Release the unused portion back to available balance
  -- (No ledger entry needed — the reservation simply stops holding the BITS)
  SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
  FROM public.get_available_balance(v_user_id) b;

  RETURN QUERY SELECT true, (v_settle_amt + v_overage), v_release_amt, v_available, 'settled';
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_bits(UUID, INTEGER, TEXT, TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bits(UUID, INTEGER, TEXT, TEXT, TEXT) TO service_role;
ALTER FUNCTION public.settle_bits(UUID, INTEGER, TEXT, TEXT, TEXT) SET search_path = '';

-- ─────────────────────────────────────────────────────────────
-- refund_credits: durable, idempotent ledger refund
--
-- The legacy implementation incremented users.credits with no idempotency
-- key, no ledger entry, and no concurrency protection — and the column it
-- targeted no longer exists, so every call errored out. Retries could never
-- be audited and the canonical ledger never saw the refund.
--
-- The refund is now a credit_ledger row (category 'refund', bucket 'monthly')
-- keyed 'refund_credits:<run_id>'. The credit_ledger idempotency unique index
-- plus the per-user advisory lock make retries and concurrent calls safe
-- across processes and connections.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_run_id   UUID,
  p_credits  INTEGER
) RETURNS VOID AS $$
DECLARE
  v_user_id   UUID;
  v_refund_id UUID;
BEGIN
  IF p_credits <= 0 THEN RETURN; END IF;

  SELECT user_id INTO v_user_id
  FROM public.agent_runs WHERE id = p_run_id;

  IF v_user_id IS NULL THEN RETURN; END IF;

  -- Serialize balance mutations for this user
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  -- Durable idempotency: one refund credit per run, enforced by the
  -- credit_ledger idempotency unique index. ON CONFLICT DO NOTHING returns
  -- no row when the refund was already recorded.
  INSERT INTO public.credit_ledger (
    user_id, amount, direction, category, balance_bucket,
    description, idempotency_key, reference_type, reference_id
  ) VALUES (
    v_user_id, p_credits, 'credit', 'refund', 'monthly',
    'Refund for agent run ' || p_run_id::TEXT,
    'refund_credits:' || p_run_id::TEXT,
    'agent_run',
    p_run_id::TEXT
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_refund_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.refund_credits(UUID, INTEGER) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(UUID, INTEGER) TO service_role;
ALTER FUNCTION public.refund_credits(UUID, INTEGER) SET search_path = '';
