-- #684 expired-reservation sweep.
--
-- NOT APPLIED. Do not run this migration from the #684 draft.
-- No pg_cron schedule is registered. vercel.json is not changed.
-- The HTTP route refuses to call this function unless
-- BILLING_RESERVATION_SWEEP_ENABLED=1, which is left unset.
--
-- Single source of truth stays reserve_bits / settle_bits / release_bits.
-- This function claims rows and then calls those RPCs. It does not insert
-- into credit_ledger itself.
--
-- Concurrency: FOR UPDATE SKIP LOCKED so two workers cannot claim the same
-- reservation. settle_bits / release_bits then take the row lock again and
-- no-op when the status is no longer 'reserved' (already_settled /
-- already_released). A late approve/reject that settles first wins; this
-- sweep's settle returns already_settled and does not debit again.

BEGIN;

-- Allow settling a reservation whose expires_at has passed but whose status
-- is still 'reserved'. Status 'expired' / 'released' / 'settled' is unchanged.
-- Default false, so existing  callers keep today's rejection of past-expiry settles.
DROP FUNCTION IF EXISTS public.settle_bits(uuid, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.settle_bits(
  p_reservation_id  UUID,
  p_actual_amount   INTEGER,
  p_idempotency_key TEXT,
  p_overage_policy  TEXT DEFAULT 'reject',
  p_description     TEXT DEFAULT NULL,
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
  v_ledger_key   TEXT;
  v_user_id      UUID;
BEGIN
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

  SELECT * INTO v_reservation
  FROM public.credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'reservation_not_found';
    RETURN;
  END IF;

  v_user_id := v_reservation.user_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  IF v_reservation.status = 'settled' THEN
    SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
    FROM public.get_available_balance(v_user_id) b;
    RETURN QUERY SELECT true, v_reservation.settled_amount, 0, v_available, 'already_settled';
    RETURN;
  END IF;

  IF v_reservation.status = 'released' THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'reservation_already_released';
    RETURN;
  END IF;

  -- Past expires_at is chargeable only for an explicit abandoned-hold settle,
  -- and only while status is still 'reserved'. A row already marked expired
  -- stays unchargeable.
  IF v_reservation.status = 'expired'
     OR (v_reservation.expires_at <= now() AND NOT COALESCE(p_allow_past_expiry, false)) THEN
    RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'reservation_expired';
    RETURN;
  END IF;

  v_settle_amt := LEAST(p_actual_amount, v_reservation.reserved_amount);
  v_release_amt := v_reservation.reserved_amount - v_settle_amt;
  v_overage := GREATEST(p_actual_amount - v_reservation.reserved_amount, 0);

  IF v_overage > 0 THEN
    IF p_overage_policy = 'reject' THEN
      RETURN QUERY SELECT false, 0, 0, NULL::INTEGER, 'overage_rejected';
      RETURN;
    END IF;
    SELECT b.available INTO v_available
    FROM public.get_available_balance(v_user_id) b;
    IF v_available < v_overage THEN
      RETURN QUERY SELECT false, 0, 0, v_available, 'overage_insufficient_balance';
      RETURN;
    END IF;
  END IF;

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

  UPDATE public.credit_reservations
  SET status = 'settled',
      settled_amount = v_settle_amt + v_overage,
      settled_at = now()
  WHERE id = p_reservation_id
    AND status = 'reserved';

  SELECT GREATEST(b.available, 0)::INTEGER INTO v_available
  FROM public.get_available_balance(v_user_id) b;

  RETURN QUERY SELECT true, (v_settle_amt + v_overage), v_release_amt, v_available, 'settled';
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_bits(uuid, integer, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bits(uuid, integer, text, text, text, boolean)
  TO service_role;

CREATE INDEX IF NOT EXISTS credit_reservations_status_expires
  ON public.credit_reservations (expires_at)
  WHERE status = 'reserved';

CREATE OR REPLACE FUNCTION public.sweep_expired_reservations(p_now timestamptz DEFAULT now())
RETURNS TABLE(settled integer, released integer, expired integer, skipped integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_settled integer := 0;
  v_released integer := 0;
  v_expired integer := 0;
  v_skipped integer := 0;
  rec record;
  v_run uuid;
  v_phase text;
  v_accrued integer;
  v_paused text;
  v_paused_status text;
  v_paused_expires timestamptz;
  v_bits integer;
  v_success boolean;
  v_reason text;
BEGIN
  FOR rec IN
    SELECT cr.id, cr.reserved_amount, cr.expires_at
    FROM public.credit_reservations cr
    WHERE cr.status = 'reserved'
      AND (
        cr.expires_at <= p_now
        OR EXISTS (
          SELECT 1
          FROM public.agent_runs ar
          JOIN public.agent_paused_runs p
            ON p.id::text = ar.output->'studio_billing'->>'paused_run_id'
          WHERE ar.output->'studio_billing'->>'reservation_id' = cr.id::text
            AND ar.output->'studio_billing'->>'phase' IN ('awaiting_approval', 'settlement_claimed')
            AND p.status IS DISTINCT FROM 'approved'
            AND (
              p.status IN ('expired', 'rejected')
              OR (p.status = 'pending' AND p.expires_at <= p_now)
            )
        )
      )
    ORDER BY cr.expires_at
    LIMIT 100
    FOR UPDATE OF cr SKIP LOCKED
  LOOP
    v_run := NULL;
    v_phase := NULL;
    v_accrued := 0;
    v_paused := NULL;
    v_paused_status := NULL;
    v_paused_expires := NULL;

    SELECT ar.id,
           ar.output->'studio_billing'->>'phase',
           COALESCE((ar.output->'studio_billing'->>'accrued_bits')::integer, 0),
           ar.output->'studio_billing'->>'paused_run_id'
      INTO v_run, v_phase, v_accrued, v_paused
    FROM public.agent_runs ar
    WHERE ar.output->'studio_billing'->>'reservation_id' = rec.id::text
      AND ar.output->'studio_billing'->>'phase' IN ('awaiting_approval', 'settlement_claimed')
    FOR UPDATE OF ar
    LIMIT 1;

    IF v_paused IS NOT NULL THEN
      SELECT p.status, p.expires_at
        INTO v_paused_status, v_paused_expires
      FROM public.agent_paused_runs p
      WHERE p.id::text = v_paused;
    END IF;

    -- An approved resume still owns the reservation. Do not settle the
    -- pre-pause amount out from under it.
    IF v_paused_status = 'approved' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_phase IN ('awaiting_approval', 'settlement_claimed') AND v_accrued > 0 THEN
      v_bits := LEAST(v_accrued, rec.reserved_amount);
      SELECT s.success, s.reason
        INTO v_success, v_reason
      FROM public.settle_bits(
        rec.id,
        v_bits,
        'expire:' || rec.id::text,
        'reject',
        'Abandoned Studio approval: settle completed work',
        true
      ) s;
      IF v_success AND v_reason = 'settled' THEN
        v_settled := v_settled + 1;
        UPDATE public.agent_runs
        SET output = jsonb_set(output, '{studio_billing,phase}', '"expired_settled"'::jsonb, true),
            updated_at = now()
        WHERE id = v_run
          AND output->'studio_billing'->>'phase' IN ('awaiting_approval', 'settlement_claimed');
      ELSE
        -- already_settled / reservation_already_released: the approve or
        -- reject path won. Do not debit again.
        v_skipped := v_skipped + 1;
      END IF;
    ELSIF v_phase IN ('awaiting_approval', 'settlement_claimed') AND v_accrued <= 0 THEN
      SELECT s.success, s.reason
        INTO v_success, v_reason
      FROM public.release_bits(rec.id, 'expire:' || rec.id::text) s;
      IF v_success THEN
        v_released := v_released + 1;
        UPDATE public.agent_runs
        SET output = jsonb_set(output, '{studio_billing,phase}', '"expired_released"'::jsonb, true),
            updated_at = now()
        WHERE id = v_run
          AND output->'studio_billing'->>'phase' IN ('awaiting_approval', 'settlement_claimed');
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSIF rec.expires_at <= p_now THEN
      UPDATE public.credit_reservations
      SET status = 'expired'
      WHERE id = rec.id
        AND status = 'reserved';
      IF FOUND THEN
        v_expired := v_expired + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_settled, v_released, v_expired, v_skipped;
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_expired_reservations(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_reservations(timestamptz)
  TO service_role;

-- Keep the old entry point, but route it through the sweep so a caller of
-- expire_stale_reservations cannot mark a Studio hold expired before the
-- completed work is settled.
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expired integer;
BEGIN
  SELECT s.expired INTO v_expired FROM public.sweep_expired_reservations(now()) s;
  RETURN COALESCE(v_expired, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_reservations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_reservations()
  TO service_role;

-- Register the unapproved 100 LiTTBits = $1 policy. v1 (1000 LLM bits/$) is
-- left in place. approved_by is the literal UNAPPROVED marker. effective_from
-- is in the future so a date-ordered reader does not treat this row as live.
INSERT INTO public.exchange_rate_versions
  (id, label, bits_per_usd_micro_num, bits_per_usd_micro_den, effective_from, approved_by)
VALUES
  ('littbits-exchange-v2-100-unapproved',
   'UNAPPROVED — 100 LiTTBits per USD on the LLM lane. Pending owner economics review. Not an approval to change customer prices, allowances, balances, or Stripe.',
   100, 1000000, '2099-01-01T00:00:00Z', 'UNAPPROVED:pending-owner-economics-review')
ON CONFLICT (id) DO NOTHING;

COMMIT;
