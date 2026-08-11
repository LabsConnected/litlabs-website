-- Service inquiries — leads from the /hire page
-- This migration reflects the EXACT schema already applied in production Supabase.
-- Do NOT re-run this against production — it is idempotent (IF NOT EXISTS) but
-- the table already exists with these 15 columns.

CREATE TABLE IF NOT EXISTS public.service_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text,
  service_id text,
  service_name text,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  company text,
  message text,
  status text NOT NULL DEFAULT 'new',
  source text NOT NULL DEFAULT 'hire_page',
  referral_code text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_inquiries_status ON public.service_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_service_inquiries_email ON public.service_inquiries(email);
CREATE INDEX IF NOT EXISTS idx_service_inquiries_created_at ON public.service_inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_inquiries_service_id ON public.service_inquiries(service_id);
CREATE INDEX IF NOT EXISTS idx_service_inquiries_clerk_user_id ON public.service_inquiries(clerk_user_id);

ALTER TABLE public.service_inquiries ENABLE ROW LEVEL SECURITY;

-- Only service role (server-side) can read/write.
-- Anonymous clients cannot read or write the table directly.
DROP POLICY IF EXISTS "Service role full access" ON public.service_inquiries;
CREATE POLICY "Service role full access"
  ON public.service_inquiries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Auto-update updated_at on row change
DROP FUNCTION IF EXISTS update_service_inquiries_updated_at();
CREATE OR REPLACE FUNCTION update_service_inquiries_updated_at()
  RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_service_inquiries_updated_at ON public.service_inquiries;
CREATE TRIGGER trg_service_inquiries_updated_at
  BEFORE UPDATE ON public.service_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION update_service_inquiries_updated_at();
