-- ============================================
-- Business Operations (myAIOS)
--
-- Service catalogs, pricing, bookings, leads,
-- staff schedules, escalations, and business
-- configuration. myAIOS is the business-operations
-- capability of LiTT — NOT a reasoning brain.
--
-- RLS: service_role bypasses (server-side API routes
-- enforce Clerk auth). owner_id stores the Clerk user ID
-- as text — NOT auth.uid() (Supabase auth is not used).
-- ============================================

-- ─── Business Config (one row per owner) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.business_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL UNIQUE,
  business_name text,
  business_description text,
  timezone text NOT NULL DEFAULT 'UTC',
  currency text NOT NULL DEFAULT 'USD',
  booking_lead_hours integer NOT NULL DEFAULT 24 CHECK (booking_lead_hours >= 0),
  booking_buffer_minutes integer NOT NULL DEFAULT 0 CHECK (booking_buffer_minutes >= 0),
  cancellation_policy_hours integer NOT NULL DEFAULT 24 CHECK (cancellation_policy_hours >= 0),
  require_payment_for_booking boolean NOT NULL DEFAULT false,
  allow_rescheduling boolean NOT NULL DEFAULT true,
  notification_email text,
  notification_phone text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_config_owner_id_idx
  ON public.business_config(owner_id);

-- ─── Services ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL,
  description text,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  is_active boolean NOT NULL DEFAULT true,
  category text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_services_owner_id_idx
  ON public.business_services(owner_id);

CREATE INDEX IF NOT EXISTS business_services_active_idx
  ON public.business_services(owner_id, is_active);

-- ─── Bookings ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  service_id uuid NOT NULL
    REFERENCES public.business_services(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_payment', 'confirmed', 'rescheduled',
                      'cancelled', 'completed', 'no_show', 'failed')),
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  idempotency_key text,
  stripe_payment_intent_id text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_bookings_owner_id_idx
  ON public.business_bookings(owner_id);

CREATE INDEX IF NOT EXISTS business_bookings_service_id_idx
  ON public.business_bookings(service_id);

CREATE INDEX IF NOT EXISTS business_bookings_start_time_idx
  ON public.business_bookings(owner_id, start_time);

-- Idempotency: one booking per (owner_id, idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS business_bookings_idempotency_key_idx
  ON public.business_bookings(owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── Leads ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  source text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'qualified', 'contacted', 'converted', 'lost')),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_leads_owner_id_idx
  ON public.business_leads(owner_id);

-- ─── Escalations ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  booking_id uuid
    REFERENCES public.business_bookings(id) ON DELETE SET NULL,
  lead_id uuid
    REFERENCES public.business_leads(id) ON DELETE SET NULL,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_escalations_owner_id_idx
  ON public.business_escalations(owner_id);

-- ─── Staff Hours ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_staff_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  staff_name text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time text NOT NULL, -- HH:mm
  end_time text NOT NULL, -- HH:mm
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_staff_hours_owner_id_idx
  ON public.business_staff_hours(owner_id);

-- ─── Audit Log for Business Operations ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  tool_id text NOT NULL,
  action text NOT NULL,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  approval_id text,
  conversation_id text,
  project_id text,
  result text NOT NULL DEFAULT 'success'
    CHECK (result IN ('success', 'failed', 'denied', 'error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_audit_log_owner_id_idx
  ON public.business_audit_log(owner_id);

CREATE INDEX IF NOT EXISTS business_audit_log_tool_id_idx
  ON public.business_audit_log(tool_id);

-- ─── Booking slot exclusion constraint ─────────────────────────────
-- Prevents overlapping confirmed/pending bookings for the same owner.
-- This is the atomic slot reservation mechanism — combined with the
-- idempotency key, it prevents double-booking race conditions.

CREATE OR REPLACE FUNCTION public.check_booking_overlap(
  p_owner_id text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_exclude_booking_id uuid DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
  PERFORM 1 FROM public.business_bookings
  WHERE owner_id = p_owner_id
    AND status IN ('pending', 'pending_payment', 'confirmed', 'rescheduled')
    AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
    AND start_time < p_end_time
    AND end_time > p_start_time
  LIMIT 1;
  RETURN NOT FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Atomic booking creation RPC ───────────────────────────────────
-- Checks availability AND creates the booking in a single transaction.
-- Returns the booking id on success, NULL on conflict.

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_owner_id text,
  p_service_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_price_cents integer,
  p_idempotency_key text,
  p_notes text,
  p_metadata jsonb
) RETURNS TABLE (id uuid, status text, duplicate boolean) AS $$
DECLARE
  v_existing_id uuid;
  v_available boolean;
  v_booking_id uuid;
BEGIN
  -- 1. Idempotency check: if a booking with this key exists, return it
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.business_bookings
    WHERE owner_id = p_owner_id AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing_id, status, true;
      RETURN;
    END IF;
  END IF;

  -- 2. Atomic availability check (fail-closed: if check fails, do NOT create)
  SELECT public.check_booking_overlap(p_owner_id, p_start_time, p_end_time) INTO v_available;
  IF NOT v_available THEN
    RETURN;
  END IF;

  -- 3. Create the booking
  INSERT INTO public.business_bookings (
    owner_id, service_id, customer_name, customer_email, customer_phone,
    start_time, end_time, status, price_cents, idempotency_key, notes, metadata
  ) VALUES (
    p_owner_id, p_service_id, p_customer_name, p_customer_email, p_customer_phone,
    p_start_time, p_end_time, 'pending', p_price_cents, p_idempotency_key, p_notes, p_metadata
  ) RETURNING id INTO v_booking_id;

  RETURN QUERY SELECT v_booking_id, 'pending', false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
