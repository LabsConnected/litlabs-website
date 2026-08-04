-- Agent work queue — production-grade background work infrastructure.
--
-- Features:
--   - FOR UPDATE SKIP LOCKED for safe concurrent claiming
--   - Leases with expiry to handle worker crashes
--   - Retry tracking with max_attempts
--   - Idempotency keys to prevent duplicate work
--   - Cost caps per task and per agent instance
--   - Approval mode for supervised agents
--   - Schedules for recurring tasks

CREATE TABLE IF NOT EXISTS public.agent_work_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_instance_id UUID NOT NULL REFERENCES public.user_agents(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  agent_version_id UUID REFERENCES public.agent_versions(id) ON DELETE SET NULL,

  -- Task identification
  task_type TEXT NOT NULL,
  task_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,

  -- Scheduling
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recurring_cron TEXT, -- e.g., '0 9 * * 1-5' for 9am weekdays

  -- Execution state
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'running', 'completed', 'failed', 'cancelled', 'awaiting_approval')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,

  -- Lease management
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  leased_by TEXT, -- worker ID

  -- Cost control
  cost_cap_credits INTEGER NOT NULL DEFAULT 100,
  credits_spent INTEGER NOT NULL DEFAULT 0,

  -- Approval
  approval_mode TEXT NOT NULL DEFAULT 'ask-first'
    CHECK (approval_mode IN ('supervised', 'autonomous', 'ask-first')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  -- Result
  result JSONB,
  error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Unique idempotency key prevents duplicate tasks
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_queue_idempotency
  ON public.agent_work_queue(idempotency_key);

-- Index for claiming pending tasks (FOR UPDATE SKIP LOCKED)
CREATE INDEX IF NOT EXISTS idx_work_queue_claim
  ON public.agent_work_queue(status, scheduled_at)
  WHERE status = 'pending';

-- Index for finding expired leases
CREATE INDEX IF NOT EXISTS idx_work_queue_lease_expiry
  ON public.agent_work_queue(lease_expires_at)
  WHERE status = 'leased';

-- Index for user's tasks
CREATE INDEX IF NOT EXISTS idx_work_queue_user
  ON public.agent_work_queue(user_id, status);

-- Index for agent instance's tasks
CREATE INDEX IF NOT EXISTS idx_work_queue_instance
  ON public.agent_work_queue(agent_instance_id, status);

ALTER TABLE public.agent_work_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_work_queue ON public.agent_work_queue;
CREATE POLICY service_role_all_work_queue ON public.agent_work_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── claim_next_work RPC ────────────────────────────────────────────
-- Atomically claims the next pending work item using FOR UPDATE SKIP LOCKED.
-- Returns the work item and sets its status to 'leased' with a lease expiry.

CREATE OR REPLACE FUNCTION public.claim_next_work(
  p_worker_id TEXT,
  p_lease_duration_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  id UUID,
  user_id UUID,
  agent_instance_id UUID,
  agent_id UUID,
  agent_version_id UUID,
  task_type TEXT,
  task_payload JSONB,
  idempotency_key TEXT,
  attempts INTEGER,
  max_attempts INTEGER,
  cost_cap_credits INTEGER,
  credits_spent INTEGER,
  approval_mode TEXT
) AS $$
DECLARE
  v_work_id UUID;
  v_lease_expires TIMESTAMPTZ;
BEGIN
  v_lease_expires := now() + (p_lease_duration_seconds || ' seconds')::INTERVAL;

  -- Atomically claim the next pending task
  UPDATE public.agent_work_queue
  SET
    status = 'leased',
    attempts = attempts + 1,
    leased_at = now(),
    lease_expires_at = v_lease_expires,
    leased_by = p_worker_id,
    updated_at = now()
  WHERE id = (
    SELECT id FROM public.agent_work_queue
    WHERE status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING id INTO v_work_id;

  IF v_work_id IS NULL THEN
    -- Also check for expired leases (re-queue them)
    UPDATE public.agent_work_queue
    SET
      status = 'pending',
      leased_at = NULL,
      lease_expires_at = NULL,
      leased_by = NULL,
      updated_at = now()
    WHERE status = 'leased'
      AND lease_expires_at < now()
      AND attempts < max_attempts
    RETURNING id INTO v_work_id;

    IF v_work_id IS NULL THEN
      RETURN;
    END IF;

    -- Re-claim the re-queued task
    UPDATE public.agent_work_queue
    SET
      status = 'leased',
      attempts = attempts + 1,
      leased_at = now(),
      lease_expires_at = v_lease_expires,
      leased_by = p_worker_id,
      updated_at = now()
    WHERE id = v_work_id;
  END IF;

  RETURN QUERY
  SELECT
    w.id, w.user_id, w.agent_instance_id, w.agent_id, w.agent_version_id,
    w.task_type, w.task_payload, w.idempotency_key, w.attempts, w.max_attempts,
    w.cost_cap_credits, w.credits_spent, w.approval_mode
  FROM public.agent_work_queue w
  WHERE w.id = v_work_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── complete_work RPC ─────────────────────────────────────────────
-- Marks a work item as completed or failed, with idempotency.

CREATE OR REPLACE FUNCTION public.complete_work(
  p_work_id UUID,
  p_status TEXT,
  p_result JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_credits_spent INTEGER DEFAULT 0
) RETURNS VOID AS $$
BEGIN
  UPDATE public.agent_work_queue
  SET
    status = p_status,
    result = p_result,
    error = p_error,
    credits_spent = credits_spent + p_credits_spent,
    completed_at = CASE WHEN p_status IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = p_work_id AND status = 'leased';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
