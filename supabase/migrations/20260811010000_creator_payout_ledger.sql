-- Creator payout ledger — tracks revenue splits for marketplace agents/models.
-- This is SEPARATE from the user wallet (credit_ledger). These are real
-- payouts owed to creators, not internal LiTTBits credits.
CREATE TABLE IF NOT EXISTS public.creator_payout_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  customer_clerk_id text NOT NULL,
  customer_charge_bits integer NOT NULL DEFAULT 0,
  provider_cost_bits integer NOT NULL DEFAULT 0,
  net_revenue integer NOT NULL DEFAULT 0,
  creator_share integer NOT NULL DEFAULT 0,
  platform_share integer NOT NULL DEFAULT 0,
  transaction_id text NOT NULL UNIQUE,
  payout_status text NOT NULL DEFAULT 'pending',
  paid_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_payout_creator ON public.creator_payout_ledger(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_creator_payout_agent ON public.creator_payout_ledger(agent_id);
CREATE INDEX IF NOT EXISTS idx_creator_payout_transaction ON public.creator_payout_ledger(transaction_id);

ALTER TABLE public.creator_payout_ledger ENABLE ROW LEVEL SECURITY;

-- Creators can view their own payout records
DROP POLICY IF EXISTS "Creators can view own payouts" ON public.creator_payout_ledger;
CREATE POLICY "Creators can view own payouts"
  ON public.creator_payout_ledger FOR SELECT
  USING (auth.jwt() ->> 'sub' IN (
    SELECT clerk_id FROM public.users WHERE id = creator_user_id
  ));
