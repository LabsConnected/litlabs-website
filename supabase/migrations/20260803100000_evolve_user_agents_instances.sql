-- Evolve user_agents from an installation marker into the canonical
-- private agent-instance record.
--
-- The existing table already has: id, user_id, agent_id (UUID FK to agents),
-- installed_at, is_active, owner_id, name, avatar_url, instructions, model,
-- enabled_tools, memory_policy, autonomy, monthly_budget, project_ids,
-- voice_settings, data_retention_days, is_default.
--
-- This migration adds the missing columns needed for a complete digital
-- employee: agent_version_id, display_name, status, memory_namespace,
-- approval_mode, daily_budget_credits, per_run_budget_credits, settings,
-- last_active_at.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so re-running is safe.

-- 1. Link to the published immutable agent version.
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS agent_version_id UUID REFERENCES public.agent_versions(id) ON DELETE SET NULL;

-- 2. Private display name (overrides the template name).
--    The existing `name` column is repurposed as the display_name.
--    We add a generated column alias for code that expects `display_name`.
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS display_name TEXT GENERATED ALWAYS AS (COALESCE(name, 'Agent')) STORED;

-- 3. Instance lifecycle status.
--    active = running normally, paused = user paused, disabled = admin/refund, error = faulted.
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'paused', 'disabled', 'error'));

-- 4. Isolated memory namespace per instance.
--    Defaults to the instance ID — ensures memories are scoped per agent.
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS memory_namespace TEXT;

-- 5. Approval mode (supersedes `autonomy` for marketplace agents).
--    supervised = user approves actions before execution
--    autonomous = agent runs without per-action approval
--    ask-first = agent asks before destructive actions (default)
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'ask-first'
  CHECK (approval_mode IN ('supervised', 'autonomous', 'ask-first'));

-- 6. Budget controls.
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS daily_budget_credits INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS per_run_budget_credits INTEGER NOT NULL DEFAULT 0;

-- 7. Flexible settings JSON (for future per-agent config without schema changes).
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 8. Last activity timestamp (updated on each agent run).
ALTER TABLE public.user_agents
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- 9. Backfill: set memory_namespace to the instance ID for existing rows.
UPDATE public.user_agents
  SET memory_namespace = id::text
  WHERE memory_namespace IS NULL;

-- 10. Backfill: set status from is_active for existing rows.
UPDATE public.user_agents
  SET status = CASE WHEN is_active THEN 'active' ELSE 'paused' END
  WHERE status = 'active' AND is_active = false;

-- 11. Index for querying a user's agent instances by status.
CREATE INDEX IF NOT EXISTS idx_user_agents_user_status
  ON public.user_agents(user_id, status);

-- 12. Index for looking up by memory_namespace.
CREATE INDEX IF NOT EXISTS idx_user_agents_memory_namespace
  ON public.user_agents(memory_namespace);

-- 13. Ensure RLS is enabled (should already be from earlier migrations).
ALTER TABLE public.user_agents ENABLE ROW LEVEL SECURITY;

-- ─── agent_runs table ───────────────────────────────────────────────
-- Records every execution of a marketplace agent instance.
-- Used for billing audit, usage analytics, and cost tracking.

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_instance_id UUID NOT NULL REFERENCES public.user_agents(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  agent_version_id UUID REFERENCES public.agent_versions(id) ON DELETE SET NULL,
  conversation_id TEXT,
  message_id TEXT,
  idempotency_key TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'refunded')),
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- `agent_runs` was introduced by an older migration with a smaller schema.
-- CREATE TABLE IF NOT EXISTS does not evolve that existing table, so add the
-- execution/billing columns explicitly before creating indexes or functions.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_instance_id UUID REFERENCES public.user_agents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_version_id UUID REFERENCES public.agent_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_charged INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON public.agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_instance ON public.agent_runs(agent_instance_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_idempotency ON public.agent_runs(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_idempotency_unique
  ON public.agent_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_agent_runs ON public.agent_runs;
CREATE POLICY service_role_all_agent_runs ON public.agent_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── charge_credits RPC ─────────────────────────────────────────────
-- Atomically charges LiTTBits for an agent run. Idempotent — if the
-- run was already charged, this is a no-op.

CREATE OR REPLACE FUNCTION public.charge_credits(
  p_run_id UUID,
  p_credits INTEGER
) RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_already_charged INTEGER;
BEGIN
  -- Check if this run was already charged (idempotency)
  SELECT credits_charged INTO v_already_charged
  FROM public.agent_runs WHERE id = p_run_id;

  IF v_already_charged >= p_credits THEN
    RETURN; -- Already charged
  END IF;

  -- Get the user ID from the run
  SELECT user_id INTO v_user_id
  FROM public.agent_runs WHERE id = p_run_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Agent run not found: %', p_run_id;
  END IF;

  -- Atomically deduct credits from the user's balance
  BEGIN
    UPDATE public.users
    SET credits = GREATEST(0, COALESCE(credits, 0) - p_credits),
        updated_at = now()
    WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── reserve_credits RPC ────────────────────────────────────────────
-- Atomically reserves (deducts) credits from the user's balance BEFORE
-- the model call. Raises an exception if the balance is insufficient.

CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_user_id UUID,
  p_credits INTEGER
) RETURNS VOID AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  IF p_credits <= 0 THEN RETURN; END IF;

  SELECT COALESCE(credits, 0) INTO v_balance
  FROM public.users WHERE id = p_user_id FOR UPDATE;

  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'insufficient balance: have %, need %', v_balance, p_credits;
  END IF;

  UPDATE public.users
  SET credits = v_balance - p_credits,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── refund_credits RPC ─────────────────────────────────────────────
-- Refunds unused reserved credits back to the user's balance.
-- Idempotent — checks if the run was already refunded.

CREATE OR REPLACE FUNCTION public.refund_credits(
  p_run_id UUID,
  p_credits INTEGER
) RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF p_credits <= 0 THEN RETURN; END IF;

  SELECT user_id INTO v_user_id
  FROM public.agent_runs WHERE id = p_run_id;

  IF v_user_id IS NULL THEN RETURN; END IF;

  UPDATE public.users
  SET credits = COALESCE(credits, 0) + p_credits,
      updated_at = now()
  WHERE id = v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
