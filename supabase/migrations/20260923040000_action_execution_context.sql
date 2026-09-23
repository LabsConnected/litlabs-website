-- Explicit ActionExecutionContext propagation.
--
-- A Studio launch creates/resolves one parent ActionRun once. Tool calls are
-- durable events inside that run; approval pauses must preserve the same run
-- identity across resume. The nullable FK is non-destructive and keeps a
-- paused-run row inspectable even for pre-context legacy data.

ALTER TABLE public.agent_paused_runs
  ADD COLUMN IF NOT EXISTS action_run_id UUID;

ALTER TABLE public.agent_paused_runs
  DROP CONSTRAINT IF EXISTS agent_paused_runs_action_run_owner_fkey,
  ADD CONSTRAINT agent_paused_runs_action_run_owner_fkey
    FOREIGN KEY (action_run_id, user_id)
    REFERENCES public.action_runs(id, user_id)
    ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_agent_paused_runs_action_run
  ON public.agent_paused_runs(action_run_id)
  WHERE action_run_id IS NOT NULL;

COMMENT ON COLUMN public.agent_paused_runs.action_run_id IS
  'Parent ActionRun that must continue under the same execution context after approval';

-- Canonical tool lifecycle vocabulary. Non-browser tools share the parent
-- ActionRun through these events; browser tools retain their more specific
-- browser.* vocabulary.
CREATE OR REPLACE FUNCTION public.action_runtime_is_event_type(p_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN (
    'run.created', 'run.started', 'run.status', 'run.completed', 'run.failed',
    'run.cancelled', 'agent.started', 'agent.status', 'agent.completed',
    'agent.failed', 'tool.started', 'tool.completed', 'tool.failed',
    'preview.started', 'preview.ready', 'preview.failed',
    'browser.session.started', 'browser.session.updated',
    'browser.session.completed', 'browser.session.failed',
    'browser.action.started', 'browser.action.completed',
    'browser.action.failed', 'browser.user_required',
    'browser.user_control_started', 'browser.user_control_returned',
    'approval.required', 'approval.approved', 'approval.rejected',
    'activity.created', 'cancellation.requested', 'deployment.started',
    'deployment.status', 'deployment.completed', 'deployment.failed'
  );
$$;
