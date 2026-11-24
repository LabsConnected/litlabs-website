-- settle_bits: collapse the two overloads left by parallel billing branches
-- into one canonical function.
--
-- Background: 20261022180000_sweep_expired_reservations (recovered #684
-- billing series) dropped the 5-arg settle_bits and created a 6-arg variant
-- with p_allow_past_expiry, but its ledger writes still hardcode the
-- 'monthly' bucket. 20261119120000_billing_settlement_bucket_allocation_
-- refund_idempotency (already on main, unapplied on hosted DBs) then
-- recreated the 5-arg signature with bucket-aware allocate_ledger_debit
-- writes. Applied together they leave TWO overloads, so any 5-argument
-- call is ambiguous ("function is not unique") and the sweep's 6-arg call
-- silently bypasses the bucket-allocation fix.
--
-- This migration drops both overloads and creates a single canonical
-- settle_bits: the bucket-aware body from 20261119120000 plus the
-- p_allow_past_expiry parameter and the status='reserved' update guard
-- from the sweep variant. Callers using the original 5 named/positional
-- arguments are unaffected (the new parameter defaults to false).

BEGIN;

DROP FUNCTION IF EXISTS public.settle_bits(uuid, integer, text, text, text);
DROP FUNCTION IF EXISTS public.settle_bits(uuid, integer, text, text, text, boolean);

CREATE FUNCTION public.settle_bits(
  p_reservation_id  UUID,
  p_actual_amount   INTEGER,
  p_idempotency_key TEXT,
  p_overage_policy  TEXT  DEFAULT 'reject',
  p_description     TEXT  DEFAULT NULL,
  p_allow_past_expiry BOOLEAN DEFAULT false
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

  -- Past expires_at is chargeable only for an explicit abandoned-hold
  -- settle, and only while status is still 'reserved'. A row already
  -- marked 'expired' stays unchargeable.
  IF v_reservation.status = 'expired'
     OR (v_reservation.expires_at <= now() AND NOT COALESCE(p_allow_past_expiry, false)) THEN
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

  -- Update the reservation (guarded: only a still-reserved row settles)
  UPDATE public.credit_reservations
  SET
    status         = 'settled',
    settled_amount = v_settle_amt + v_overage,
    settled_at     = now()
  WHERE id = p_reservation_id
    AND status = 'reserved';

  -- Release the unused portion back to available balance
  -- (No ledger entry needed — the reservation simply stops holding the BITS)
  SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
  FROM public.get_available_balance(v_user_id) b;

  RETURN QUERY SELECT true, (v_settle_amt + v_overage), v_release_amt, v_available, 'settled';
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_bits(UUID, INTEGER, TEXT, TEXT, TEXT, BOOLEAN)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bits(UUID, INTEGER, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;
ALTER FUNCTION public.settle_bits(UUID, INTEGER, TEXT, TEXT, TEXT, BOOLEAN)
  SET search_path = '';

COMMIT;
