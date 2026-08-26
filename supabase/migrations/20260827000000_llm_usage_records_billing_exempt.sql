-- Add billing_exempt column to llm_usage_records.
-- Owner usage is metered (tokens, provider cost, model, BITS-calculated)
-- but the wallet is never debited. This column distinguishes
-- "not debited because billing-exempt" from "not debited because
-- shadow mode / BYOK / insufficient balance".
ALTER TABLE public.llm_usage_records
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;

-- Index for querying owner usage (cost analysis, spend ceiling checks)
CREATE INDEX IF NOT EXISTS idx_llm_usage_billing_exempt
  ON public.llm_usage_records(billing_exempt) WHERE billing_exempt = true;
