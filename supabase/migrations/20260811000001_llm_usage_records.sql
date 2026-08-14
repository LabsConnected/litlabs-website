-- LLM usage records — tracks every LLM call for billing and margin analysis.
-- Supports shadow mode (calculate but don't debit) and real enforcement.
CREATE TABLE IF NOT EXISTS public.llm_usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  litt_alias_id text,
  is_byok boolean NOT NULL DEFAULT false,
  billing_class text NOT NULL DEFAULT 'standard',
  provider_cost_micros bigint NOT NULL DEFAULT 0,
  retail_littbits integer NOT NULL DEFAULT 0,
  platform_margin numeric NOT NULL DEFAULT 0,
  shadow_mode boolean NOT NULL DEFAULT false,
  was_debited boolean NOT NULL DEFAULT false,
  balance_after integer,
  call_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_clerk_id ON public.llm_usage_records(clerk_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_call_id ON public.llm_usage_records(call_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON public.llm_usage_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON public.llm_usage_records(provider);

-- RLS: users can only see their own usage records
ALTER TABLE public.llm_usage_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own LLM usage" ON public.llm_usage_records;
CREATE POLICY "Users can view own LLM usage"
  ON public.llm_usage_records FOR SELECT
  USING (auth.jwt() ->> 'sub' = clerk_id);

-- Service role bypasses RLS for inserts (server-side only)
