-- B2 — Ledger Reservation + Reconciliation
--
-- Minimal production-safe kernel for the canonical billing path:
--
--   reserve_bits → execute → settle_bits | release_bits
--
-- This migration adds ONLY:
--   1. credit_reservations table
--   2. reserve_bits  RPC
--   3. settle_bits   RPC
--   4. release_bits  RPC
--
-- It does NOT:
--   - Modify credit_ledger (no new columns on the hot financial table)
--   - Create pricing_catalog, pricing_versions, exchange_rate_versions
--   - Create cost_events, rating_events, credit_grants, spend_controls
--   - Drop users.credits (vestigial but harmless)
--   - Drop wallets (legacy but has data)
--   - Change any existing RPC
--
-- Design principles:
--   - All RPCs are SECURITY DEFINER (bypass RLS, run as service role)
--   - All RPCs use pg_advisory_xact_lock for per-user serialization
--   - All RPCs are idempotent via reservation_id
--   - Reservations are BITS-denominated (exchange-rate-agnostic)
--   - Settled reservations cannot be released
--   - Released reservations cannot be settled
--   - Available balance can never go negative
--   - Every settled charge reconciles to one reservation/run identity

-- ─────────────────────────────────────────────────────────────
-- 1. credit_reservations table
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id),
  reserved_amount INTEGER     NOT NULL CHECK (reserved_amount > 0 AND reserved_amount <= 1000000),
  settled_amount  INTEGER     NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  status          TEXT        NOT NULL DEFAULT 'reserved'
                  CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
  -- Correlation: every reservation ties to a usage/run identity
  run_id          TEXT,
  usage_type      TEXT,   -- 'llm', 'generation', 'agent_run', etc.
  reference_type  TEXT,
  reference_id    TEXT,
  description     TEXT,
  -- Idempotency: same key returns same reservation
  idempotency_key TEXT    NOT NULL,
  -- Lifecycle timestamps
  reserved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique idempotency key per user (same key = same reservation)
CREATE UNIQUE INDEX IF NOT EXISTS credit_reservations_user_idem_key
  ON public.credit_reservations(user_id, idempotency_key);

-- Look up active reservations by user (for balance computation)
CREATE INDEX IF NOT EXISTS credit_reservations_user_active
  ON public.credit_reservations(user_id, status)
  WHERE status = 'reserved';

-- Look up by run_id for reconciliation
CREATE INDEX IF NOT EXISTS credit_reservations_run_id
  ON public.credit_reservations(run_id)
  WHERE run_id IS NOT NULL;

-- RLS: deny anon and authenticated (same as credit_ledger)
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_reservations_deny_anon ON public.credit_reservations;
CREATE POLICY credit_reservations_deny_anon
  ON public.credit_reservations
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS credit_reservations_deny_authenticated ON public.credit_reservations;
CREATE POLICY credit_reservations_deny_authenticated
  ON public.credit_reservations
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────
-- 2. get_available_balance(user_id)
--
--    Returns the available balance after subtracting active reservations.
--    available = ledger_total - sum(active reserved_amount)
--
--    This is the canonical "how many BITS can I spend?" query.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_available_balance(p_user_id UUID)
RETURNS TABLE(
  ledger_total   INTEGER,
  reserved_total INTEGER,
  available      INTEGER
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH
    ledger AS (
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'credit' THEN amount ELSE -amount END
      ), 0)::INTEGER AS total
      FROM public.credit_ledger
      WHERE user_id = p_user_id
        AND (expires_at IS NULL OR expires_at > now())
    ),
    reserved AS (
      SELECT COALESCE(SUM(reserved_amount), 0)::INTEGER AS total
      FROM public.credit_reservations
      WHERE user_id = p_user_id
        AND status = 'reserved'
        AND expires_at > now()
    )
  SELECT
    GREATEST(l.total, 0)::INTEGER,
    r.total,
    GREATEST(l.total - r.total, 0)::INTEGER
  FROM ledger l, reserved r;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 3. reserve_bits(user_id, amount, idempotency_key, ...)
--
--    Atomically reserves BITS against the user's available balance.
--    Uses pg_advisory_xact_lock for concurrency safety.
--    Idempotent: same (user_id, idempotency_key) returns the original reservation.
--    Fail-closed: returns success=false if insufficient available balance.
--
--    Returns: (reservation_id UUID, success BOOLEAN, available_after INTEGER, reason TEXT)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reserve_bits(
  p_user_id        UUID,
  p_amount         INTEGER,
  p_idempotency_key TEXT,
  p_run_id         TEXT DEFAULT NULL,
  p_usage_type     TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   TEXT DEFAULT NULL,
  p_description    TEXT DEFAULT NULL,
  p_expires_seconds INTEGER DEFAULT 600
)
RETURNS TABLE(
  reservation_id   UUID,
  success          BOOLEAN,
  available_after  INTEGER,
  reason           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation_id UUID;
  v_available      INTEGER;
  v_reserved_total INTEGER;
  v_ledger_total   INTEGER;
  v_existing_id    UUID;
BEGIN
  -- Validate inputs
  IF p_amount <= 0 OR p_amount > 1000000 THEN
    RETURN QUERY SELECT NULL::UUID, false, NULL::INTEGER, 'amount_must_be_1_to_1000000';
    RETURN;
  END IF;
  IF length(trim(p_idempotency_key)) < 8 THEN
    RETURN QUERY SELECT NULL::UUID, false, NULL::INTEGER, 'idempotency_key_min_8_chars';
    RETURN;
  END IF;

  -- Serialize all balance mutations for this user
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  -- Idempotency: if this key already used, return the original reservation
  SELECT id INTO v_existing_id
  FROM public.credit_reservations
  WHERE user_id = p_user_id AND idempotency_key = trim(p_idempotency_key)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
    FROM public.get_available_balance(p_user_id) b;
    RETURN QUERY SELECT v_existing_id, true, v_available, 'already_reserved';
    RETURN;
  END IF;

  -- Check available balance
  SELECT b.ledger_total, b.reserved_total, b.available
  INTO v_ledger_total, v_reserved_total, v_available
  FROM public.get_available_balance(p_user_id) b;

  IF v_available < p_amount THEN
    RETURN QUERY SELECT NULL::UUID, false, v_available, 'insufficient_balance';
    RETURN;
  END IF;

  -- Create the reservation
  INSERT INTO public.credit_reservations (
    user_id, reserved_amount, status,
    run_id, usage_type, reference_type, reference_id, description,
    idempotency_key, expires_at
  ) VALUES (
    p_user_id, p_amount, 'reserved',
    p_run_id, p_usage_type, p_reference_type, p_reference_id, trim(p_description),
    trim(p_idempotency_key),
    now() + (p_expires_seconds || ' seconds')::INTERVAL
  )
  RETURNING id INTO v_reservation_id;

  v_available := v_available - p_amount;

  RETURN QUERY SELECT v_reservation_id, true, GREATEST(v_available, 0)::INTEGER, 'reserved';
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 4. settle_bits(reservation_id, actual_amount, idempotency_key)
--
--    Settles a reservation against the actual cost.
--    - If actual_amount < reserved_amount: releases the difference.
--    - If actual_amount > reserved_amount: follows overage_policy.
--      'reject' (default): refuses the overage.
--      'allow': debits the extra from available balance.
--    - Writes a single debit to credit_ledger for the settled amount.
--    - Marks the reservation as 'settled'.
--    - Idempotent: settling twice with same key returns the original result.
--
--    Returns: (success BOOLEAN, settled_amount INTEGER, released_amount INTEGER, available_after INTEGER, reason TEXT)
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
  v_ledger_key   TEXT;
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

  -- Idempotency: if already settled with this key, return the original result
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

  -- Write the settled amount as a debit to credit_ledger
  IF v_settle_amt > 0 THEN
    v_ledger_key := p_idempotency_key || ':settle';
    INSERT INTO public.credit_ledger (
      user_id, amount, direction, category, balance_bucket,
      description, idempotency_key, reference_type, reference_id
    ) VALUES (
      v_user_id, v_settle_amt, 'debit', 'usage', 'monthly',
      COALESCE(trim(p_description), v_reservation.description),
      v_ledger_key,
      COALESCE(v_reservation.reference_type, 'reservation'),
      v_reservation.id::TEXT
    );
  END IF;

  -- Write the overage as an additional debit (if allowed)
  IF v_overage > 0 THEN
    v_ledger_key := p_idempotency_key || ':overage';
    INSERT INTO public.credit_ledger (
      user_id, amount, direction, category, balance_bucket,
      description, idempotency_key, reference_type, reference_id
    ) VALUES (
      v_user_id, v_overage, 'debit', 'usage', 'monthly',
      'Overage for ' || COALESCE(v_reservation.description, 'reservation'),
      v_ledger_key,
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

-- ─────────────────────────────────────────────────────────────
-- 5. release_bits(reservation_id, idempotency_key)
--
--    Releases a reservation without settling (e.g., execution failed).
--    - Marks the reservation as 'released'.
--    - No ledger entry is written (nothing was consumed).
--    - The reserved BITS become available again.
--    - Idempotent: releasing twice returns success.
--    - Cannot release a settled reservation.
--
--    Returns: (success BOOLEAN, released_amount INTEGER, available_after INTEGER, reason TEXT)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_bits(
  p_reservation_id  UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(
  success          BOOLEAN,
  released_amount  INTEGER,
  available_after  INTEGER,
  reason           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation public.credit_reservations%ROWTYPE;
  v_available   INTEGER;
  v_user_id     UUID;
BEGIN
  IF length(trim(p_idempotency_key)) < 8 THEN
    RETURN QUERY SELECT false, 0, NULL::INTEGER, 'idempotency_key_min_8_chars';
    RETURN;
  END IF;

  -- Load the reservation
  SELECT * INTO v_reservation
  FROM public.credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::INTEGER, 'reservation_not_found';
    RETURN;
  END IF;

  v_user_id := v_reservation.user_id;

  -- Serialize all balance mutations for this user
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  -- Already released = idempotent success
  IF v_reservation.status = 'released' THEN
    SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
    FROM public.get_available_balance(v_user_id) b;
    RETURN QUERY SELECT true, 0, v_available, 'already_released';
    RETURN;
  END IF;

  -- Cannot release a settled reservation
  IF v_reservation.status = 'settled' THEN
    RETURN QUERY SELECT false, 0, NULL::INTEGER, 'reservation_already_settled';
    RETURN;
  END IF;

  -- Release the reservation
  UPDATE public.credit_reservations
  SET
    status      = 'released',
    released_at = now()
  WHERE id = p_reservation_id;

  SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
  FROM public.get_available_balance(v_user_id) b;

  RETURN QUERY SELECT true, v_reservation.reserved_amount, v_available, 'released';
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 6. expire_stale_reservations()
--
--    Maintenance function: marks expired reservations as 'expired'.
--    Called by a cron job or application health check.
--    Does NOT release ledger entries (nothing was debited).
--
--    Returns: count of expired reservations
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH expired AS (
    UPDATE public.credit_reservations
    SET status = 'expired'
    WHERE status = 'reserved'
      AND expires_at <= now()
    RETURNING 1
  )
  SELECT count(*)::INTEGER FROM expired;
$function$;
