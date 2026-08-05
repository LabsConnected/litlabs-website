-- LiTT Reception — Complete Front Desk System
--
-- This migration creates the full Reception infrastructure:
--   reception_config     — centralized business + receptionist configuration
--   reception_services   — service catalog with Stripe price mapping
--   reception_staff_hours— actual staff availability (separate from 24/7 reception)
--   reception_bookings   — appointment booking records
--   reception_leads      — lead capture + qualification
--   reception_escalations— human handoff records
--   reception_events     — operational analytics
--
-- Design principles:
--   - One brain, multiple interfaces (chat, voice, admin)
--   - Services map to existing Stripe products (no new payment provider)
--   - Leads are separate from users (anonymous callers can be leads)
--   - Staff hours are separate from reception availability (LiTT is 24/7, staff aren't)
--   - All tables use the existing RLS pattern (owner_id = auth.jwt()->>'sub')

-- ═══════════════════════════════════════════════════════════════
-- 1. RECEPTION CONFIG — centralized business configuration
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  owner_id TEXT NOT NULL,

  -- Business information
  business_name TEXT NOT NULL DEFAULT 'LiTTree LabStudios',
  business_description TEXT NOT NULL DEFAULT 'AI-powered products, agent workflows, and creator tools.',
  website TEXT DEFAULT 'https://litlabs.net',
  contact_email TEXT,
  contact_phone TEXT DEFAULT '+16169522168',
  location TEXT DEFAULT 'United States',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',

  -- Receptionist settings
  receptionist_name TEXT NOT NULL DEFAULT 'LiTT',
  receptionist_voice TEXT DEFAULT 'warm',
  greeting TEXT NOT NULL DEFAULT 'Hey, LiTT here — what can I help with?',
  instructions TEXT,
  fallback_behavior TEXT NOT NULL DEFAULT 'take_message',

  -- Reception availability (LiTT is 24/7 by default)
  reception_24_7 BOOLEAN NOT NULL DEFAULT true,
  reception_hours JSONB DEFAULT '{}'::jsonb, -- only used if reception_24_7 is false

  -- Booking settings
  booking_rules JSONB DEFAULT '{
    "min_notice_hours": 1,
    "max_advance_days": 30,
    "buffer_minutes": 15
  }'::jsonb,
  cancellation_policy TEXT NOT NULL DEFAULT 'Cancel or reschedule up to 24 hours before your appointment for a full refund. Within 24 hours, contact us and we''ll work it out.',
  rescheduling_policy TEXT NOT NULL DEFAULT 'Reschedule up to 24 hours before with no penalty.',
  confirmation_message TEXT NOT NULL DEFAULT 'You''re booked! I''ll send a confirmation with all the details.',
  reminder_settings JSONB DEFAULT '{"enabled": true, "hours_before": 24}'::jsonb,

  -- Lead capture settings
  lead_required_fields TEXT[] NOT NULL DEFAULT '{name,email}',
  lead_optional_fields TEXT[] NOT NULL DEFAULT '{phone,company,budget,timeline,project_type}',
  qualification_questions JSONB DEFAULT '[]'::jsonb,

  -- Escalation settings
  escalation_contact TEXT,
  escalation_rules JSONB DEFAULT '{
    "escalate_on_request_human": true,
    "escalate_on_payment_issue": true,
    "escalate_on_upset_customer": true,
    "escalate_on_privileged_access": true
  }'::jsonb,
  emergency_rules JSONB DEFAULT '{}'::jsonb,

  -- Booking page
  booking_page_slug TEXT DEFAULT 'littree-labstudios',
  booking_page_intro TEXT DEFAULT 'LiTTree Lab Studios builds AI-powered products, agent workflows, and creator tools. Book a call with LiTT — your AI partner who handles everything from project scoping to product builds.',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE POLICY reception_config_owner_select ON public.reception_config
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_config_owner_insert ON public.reception_config
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_config_owner_update ON public.reception_config
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- 2. RECEPTION SERVICES — service catalog with Stripe mapping
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_services (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,

  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (
    category IN ('membership', 'product', 'service', 'consultation', 'custom')
  ),

  -- Duration
  duration_minutes INTEGER NOT NULL DEFAULT 30,

  -- Pricing
  price_cents INTEGER, -- null = price on request
  price_interval TEXT, -- null = one-time, 'month' = monthly, 'year' = yearly
  currency TEXT NOT NULL DEFAULT 'usd',
  price_on_request BOOLEAN NOT NULL DEFAULT false,

  -- Stripe mapping (links to existing Stripe products)
  stripe_product_id TEXT,
  stripe_price_id TEXT,

  -- Booking
  bookable BOOLEAN NOT NULL DEFAULT true,
  booking_buffer_minutes INTEGER NOT NULL DEFAULT 15,
  max_bookings_per_day INTEGER NOT NULL DEFAULT 10,

  -- Availability (which days this service is available)
  available_days INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}', -- 0=Sun..6=Sat
  available_hours_start TEXT NOT NULL DEFAULT '09:00',
  available_hours_end TEXT NOT NULL DEFAULT '17:00',

  -- Status
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_services_owner ON public.reception_services(owner_id);
CREATE INDEX IF NOT EXISTS idx_reception_services_active ON public.reception_services(active, sort_order);

CREATE POLICY reception_services_owner_select ON public.reception_services
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_services_owner_insert ON public.reception_services
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_services_owner_update ON public.reception_services
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_services_owner_delete ON public.reception_services
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- 3. RECEPTION STAFF HOURS — actual staff availability
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_staff_hours (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,

  staff_name TEXT NOT NULL,
  staff_role TEXT NOT NULL DEFAULT 'team',
  staff_user_id TEXT, -- links to users table if internal

  -- Working hours per day (0=Sun..6=Sat)
  -- Each day has: { "start": "09:00", "end": "17:00", "available": true }
  schedule JSONB NOT NULL DEFAULT '{
    "0": {"available": false},
    "1": {"start": "09:00", "end": "17:00", "available": true},
    "2": {"start": "09:00", "end": "17:00", "available": true},
    "3": {"start": "09:00", "end": "17:00", "available": true},
    "4": {"start": "09:00", "end": "17:00", "available": true},
    "5": {"start": "09:00", "end": "17:00", "available": true},
    "6": {"available": false}
  }'::jsonb,

  -- Time off / exceptions
  time_off JSONB DEFAULT '[]'::jsonb, -- [{ "date": "2026-01-01", "reason": "Holiday" }]

  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_staff_owner ON public.reception_staff_hours(owner_id);

CREATE POLICY reception_staff_owner_select ON public.reception_staff_hours
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_staff_owner_insert ON public.reception_staff_hours
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_staff_owner_update ON public.reception_staff_hours
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_staff_owner_delete ON public.reception_staff_hours
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- 4. RECEPTION BOOKINGS — appointment records
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_bookings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,

  -- Service
  service_id TEXT REFERENCES public.reception_services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  service_duration_minutes INTEGER NOT NULL,
  service_price_cents INTEGER,
  service_price_interval TEXT,

  -- Customer (may be a lead or an authenticated user)
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  customer_user_id TEXT, -- links to users table if authenticated

  -- Booking details
  booking_date DATE NOT NULL,
  booking_time TEXT NOT NULL, -- "14:30"
  booking_end_time TEXT NOT NULL, -- "15:00"
  timezone TEXT NOT NULL DEFAULT 'America/New_York',

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no_show')
  ),

  -- Payment
  stripe_checkout_session_id TEXT,
  stripe_payment_status TEXT, -- 'paid', 'unpaid', 'no_payment_required'
  payment_required BOOLEAN NOT NULL DEFAULT false,

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Source
  source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'chat', 'web', 'admin', 'api')),

  -- Conversation reference
  conversation_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_bookings_owner ON public.reception_bookings(owner_id);
CREATE INDEX IF NOT EXISTS idx_reception_bookings_date ON public.reception_bookings(booking_date, booking_time);
CREATE INDEX IF NOT EXISTS idx_reception_bookings_status ON public.reception_bookings(status);
CREATE INDEX IF NOT EXISTS idx_reception_bookings_customer ON public.reception_bookings(customer_email);

CREATE POLICY reception_bookings_owner_select ON public.reception_bookings
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_bookings_owner_insert ON public.reception_bookings
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_bookings_owner_update ON public.reception_bookings
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_bookings_owner_delete ON public.reception_bookings
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- 5. RECEPTION LEADS — lead capture + qualification
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_leads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,

  -- Contact info
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,

  -- Qualification
  interest TEXT NOT NULL,
  service_id TEXT REFERENCES public.reception_services(id) ON DELETE SET NULL,
  service_name TEXT,
  project_type TEXT,
  budget TEXT,
  timeline TEXT,

  -- Lead status
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'qualified', 'unqualified', 'needs_info', 'converted', 'lost', 'escalated')
  ),
  lead_score INTEGER NOT NULL DEFAULT 0, -- 0-100

  -- Qualification answers
  qualification_answers JSONB DEFAULT '{}'::jsonb,

  -- Source
  source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'chat', 'web', 'admin', 'api')),
  conversation_id TEXT,

  -- Follow-up
  follow_up_date DATE,
  follow_up_notes TEXT,
  assigned_to TEXT,

  -- Link to booking if converted
  booking_id TEXT REFERENCES public.reception_bookings(id) ON DELETE SET NULL,

  -- Link to user if authenticated
  user_id TEXT,

  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_leads_owner ON public.reception_leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_reception_leads_status ON public.reception_leads(status);
CREATE INDEX IF NOT EXISTS idx_reception_leads_email ON public.reception_leads(email);
CREATE INDEX IF NOT EXISTS idx_reception_leads_created ON public.reception_leads(created_at DESC);

CREATE POLICY reception_leads_owner_select ON public.reception_leads
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_leads_owner_insert ON public.reception_leads
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_leads_owner_update ON public.reception_leads
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_leads_owner_delete ON public.reception_leads
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- 6. RECEPTION ESCALATIONS — human handoff records
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_escalations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,

  -- Customer
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  customer_user_id TEXT,

  -- Escalation details
  reason TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'emergency')),
  intent TEXT,
  relevant_service TEXT,

  -- Conversation summary
  conversation_summary TEXT NOT NULL,
  conversation_id TEXT,

  -- Requested action
  requested_action TEXT NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'resolved', 'closed')),
  assigned_to TEXT,
  resolution_notes TEXT,

  -- Lead link
  lead_id TEXT REFERENCES public.reception_leads(id) ON DELETE SET NULL,

  source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'chat', 'web', 'admin', 'api')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_escalations_owner ON public.reception_escalations(owner_id);
CREATE INDEX IF NOT EXISTS idx_reception_escalations_status ON public.reception_escalations(status, urgency);
CREATE INDEX IF NOT EXISTS idx_reception_escalations_created ON public.reception_escalations(created_at DESC);

CREATE POLICY reception_escalations_owner_select ON public.reception_escalations
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_escalations_owner_insert ON public.reception_escalations
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_escalations_owner_update ON public.reception_escalations
  FOR UPDATE USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_escalations_owner_delete ON public.reception_escalations
  FOR DELETE USING (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- 7. RECEPTION EVENTS — operational analytics
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reception_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,

  event_type TEXT NOT NULL, -- reception_session_started, reception_call_started, etc.
  conversation_id TEXT,
  booking_id TEXT REFERENCES public.reception_bookings(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES public.reception_leads(id) ON DELETE SET NULL,
  escalation_id TEXT REFERENCES public.reception_escalations(id) ON DELETE SET NULL,

  -- Event data (no PII — follow existing analytics privacy rules)
  metadata JSONB DEFAULT '{}'::jsonb,

  source TEXT NOT NULL DEFAULT 'voice' CHECK (source IN ('voice', 'chat', 'web', 'admin', 'api')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reception_events_owner ON public.reception_events(owner_id);
CREATE INDEX IF NOT EXISTS idx_reception_events_type ON public.reception_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reception_events_conversation ON public.reception_events(conversation_id);

CREATE POLICY reception_events_owner_select ON public.reception_events
  FOR SELECT USING (owner_id = auth.jwt() ->> 'sub');
CREATE POLICY reception_events_owner_insert ON public.reception_events
  FOR INSERT WITH CHECK (owner_id = auth.jwt() ->> 'sub');

-- ═══════════════════════════════════════════════════════════════
-- SEED: Default config + services from existing Stripe products
-- ═══════════════════════════════════════════════════════════════

-- Default reception config (owner_id will be set by the app on first access)
INSERT INTO public.reception_config (id, owner_id)
VALUES ('default', 'system')
ON CONFLICT (id) DO NOTHING;

-- Default services matching existing Stripe products
-- These are created without owner_id — the app will assign them on first admin access
INSERT INTO public.reception_services (owner_id, name, description, category, duration_minutes, price_cents, price_interval, price_on_request, sort_order, metadata)
SELECT 'system', name, description, category, duration_minutes, price_cents, price_interval, price_on_request, sort_order, metadata
FROM (VALUES
  ('AI Consultation', '30-minute AI consultation to scope your project and recommend the right approach.', 'consultation', 30, 4900, NULL, false, 1, '{}'::jsonb),
  ('Agent Workflow Setup', 'Custom AI agent workflow design and implementation for your business.', 'service', 60, 2900, NULL, false, 2, '{}'::jsonb),
  ('Product Build', 'Full product build with AI-powered development. From concept to deployment.', 'service', 90, 14900, NULL, false, 3, '{}'::jsonb),
  ('Membership Onboarding', 'Get set up with your LiTTree Lab Studios membership plan.', 'membership', 30, NULL, 'month', false, 4, '{}'::jsonb),
  ('Creator Strategy Session', 'Strategy session for content creators looking to grow with AI tools.', 'consultation', 45, 1500, NULL, false, 5, '{}'::jsonb)
) AS t(name, description, category, duration_minutes, price_cents, price_interval, price_on_request, sort_order, metadata)
WHERE NOT EXISTS (SELECT 1 FROM public.reception_services WHERE owner_id = 'system');
