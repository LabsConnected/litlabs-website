-- Staging DDL for the P0 Error Handler ledger tables.
-- Target: litlabs-preview Supabase ONLY. Do NOT run against production.
-- Column sets match the field lists used by the exported workflow nodes
-- ("Claim Alert Slot", "Backfill Claim", "Delivered — Recorded",
--  "Record Failed Delivery").

CREATE TABLE IF NOT EXISTS public.n8n_alert_claims (
  alert_key        text PRIMARY KEY,
  workflow_id      text NOT NULL,
  workflow_name    text,
  execution_id     text,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  failed_node      text,
  error_signature  text
);

CREATE TABLE IF NOT EXISTS public.n8n_alert_deliveries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_key   text NOT NULL REFERENCES public.n8n_alert_claims(alert_key),
  channel     text NOT NULL,
  status      text NOT NULL CHECK (status IN ('sent','failed')),
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Server-role-only access: deny all client roles, matching repo convention
-- (see supabase/migrations/20260916010000_social_phase1.sql §5).
ALTER TABLE public.n8n_alert_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.n8n_alert_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_deny_anon ON public.n8n_alert_claims;
DROP POLICY IF EXISTS api_deny_authenticated ON public.n8n_alert_claims;
CREATE POLICY api_deny_anon ON public.n8n_alert_claims
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY api_deny_authenticated ON public.n8n_alert_claims
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS api_deny_anon ON public.n8n_alert_deliveries;
DROP POLICY IF EXISTS api_deny_authenticated ON public.n8n_alert_deliveries;
CREATE POLICY api_deny_anon ON public.n8n_alert_deliveries
  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY api_deny_authenticated ON public.n8n_alert_deliveries
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
