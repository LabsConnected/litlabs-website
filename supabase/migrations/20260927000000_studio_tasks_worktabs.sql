-- Durable Studio Tasks / Worktabs
-- One task is a durable unit of work inside a user-owned project.
-- Important runtime identity remains in canonical conversations, ActionRuns,
-- browser sessions, and project preview state; this table only associates it.

CREATE TABLE IF NOT EXISTS public.studio_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  title TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'general'
    CHECK (task_type IN ('general', 'build', 'browser', 'research', 'design', 'image', 'deploy', 'debug')),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('working', 'ready', 'waiting_approval', 'needs_verification', 'failed', 'complete', 'closed')),
  conversation_id UUID REFERENCES public.studio_conversations(id) ON DELETE SET NULL,
  active_action_run_id UUID REFERENCES public.action_runs(id) ON DELETE SET NULL,
  latest_action_run_id UUID REFERENCES public.action_runs(id) ON DELETE SET NULL,
  browser_session_id UUID REFERENCES public.browser_sessions(id) ON DELETE SET NULL,
  preview_workspace_id TEXT,
  preview_url TEXT,
  selected_artifact JSONB,
  verification_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_opened_surface TEXT,
  last_opened_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_tasks_user_project_updated
  ON public.studio_tasks(user_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_tasks_user_project_open
  ON public.studio_tasks(user_id, project_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_tasks_conversation
  ON public.studio_tasks(conversation_id)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_studio_tasks_action_run
  ON public.studio_tasks(active_action_run_id)
  WHERE active_action_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_studio_tasks_browser_session
  ON public.studio_tasks(browser_session_id)
  WHERE browser_session_id IS NOT NULL;

ALTER TABLE public.studio_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS studio_tasks_deny_anon ON public.studio_tasks;
CREATE POLICY studio_tasks_deny_anon ON public.studio_tasks
  FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS studio_tasks_deny_authenticated ON public.studio_tasks;
CREATE POLICY studio_tasks_deny_authenticated ON public.studio_tasks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS studio_tasks_service_role ON public.studio_tasks;
CREATE POLICY studio_tasks_service_role ON public.studio_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.studio_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_studio_tasks_updated_at ON public.studio_tasks;
CREATE TRIGGER trigger_studio_tasks_updated_at
  BEFORE UPDATE ON public.studio_tasks
  FOR EACH ROW EXECUTE FUNCTION public.studio_tasks_updated_at();

COMMENT ON TABLE public.studio_tasks IS
  'Durable Studio task/worktab associations. Runtime truth remains in conversations, action_runs, browser_sessions, and project preview state.';
