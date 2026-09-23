-- LiTT Action Runtime — durable product-level run and event state.
-- Provider records remain the execution source of truth. These tables provide
-- the shared lifecycle/activity contract for Studio and reconnecting clients.
--
-- Mutations use SECURITY DEFINER RPCs with explicit user ownership checks.
-- The application uses the service-role client for these calls; RLS remains
-- useful for authenticated direct reads, but is not the authorization boundary
-- for server mutations.

CREATE TABLE IF NOT EXISTS public.action_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  project_id TEXT,
  conversation_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('browser', 'studio', 'deployment', 'agent', 'composite')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'starting', 'working', 'waiting_for_user', 'user_controlling',
    'paused', 'completed', 'failed', 'cancelled'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  current_activity TEXT,
  browser_session_id UUID REFERENCES public.browser_sessions(id) ON DELETE SET NULL,
  cancellation_requested_at TIMESTAMPTZ,
  approval_reference TEXT,
  failure_code TEXT,
  failure_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_action_runs_user_created
  ON public.action_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_conversation
  ON public.action_runs(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_project
  ON public.action_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_status
  ON public.action_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_runs_browser_session
  ON public.action_runs(browser_session_id);

ALTER TABLE public.action_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_action_runs ON public.action_runs;
CREATE POLICY service_role_all_action_runs ON public.action_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_action_runs ON public.action_runs;
CREATE POLICY users_read_own_action_runs ON public.action_runs
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE TABLE IF NOT EXISTS public.action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_action_events_run_sequence
  ON public.action_events(run_id, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_action_events_user_sequence
  ON public.action_events(user_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_action_events_type
  ON public.action_events(type, sequence DESC);

ALTER TABLE public.action_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_action_events ON public.action_events;
CREATE POLICY service_role_all_action_events ON public.action_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_action_events ON public.action_events;
CREATE POLICY users_read_own_action_events ON public.action_events
  FOR SELECT USING (auth.uid()::text = user_id);

-- Shared transition predicate. This is deliberately duplicated in the
-- TypeScript pure state machine so invalid transitions fail closed in both
-- application tests and the database transaction.
CREATE OR REPLACE FUNCTION public.action_runtime_can_transition(
  p_from TEXT,
  p_to TEXT
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_from = p_to OR CASE p_from
    WHEN 'queued' THEN p_to IN ('starting', 'working', 'paused', 'failed', 'cancelled')
    WHEN 'starting' THEN p_to IN ('working', 'waiting_for_user', 'paused', 'failed', 'cancelled')
    WHEN 'working' THEN p_to IN ('waiting_for_user', 'user_controlling', 'paused', 'completed', 'failed', 'cancelled')
    WHEN 'waiting_for_user' THEN p_to IN ('user_controlling', 'working', 'paused', 'failed', 'cancelled')
    WHEN 'user_controlling' THEN p_to IN ('working', 'waiting_for_user', 'paused', 'failed', 'cancelled')
    WHEN 'paused' THEN p_to IN ('starting', 'working', 'waiting_for_user', 'failed', 'cancelled')
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_create_run(
  p_id UUID,
  p_user_id TEXT,
  p_project_id TEXT,
  p_conversation_id TEXT,
  p_kind TEXT,
  p_current_activity TEXT DEFAULT NULL,
  p_browser_session_id UUID DEFAULT NULL
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.action_runs;
BEGIN
  INSERT INTO public.action_runs (
    id, user_id, project_id, conversation_id, kind, status,
    current_activity, browser_session_id
  ) VALUES (
    p_id, p_user_id, p_project_id, p_conversation_id, p_kind, 'queued',
    p_current_activity, p_browser_session_id
  ) RETURNING * INTO v_run;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (v_run.id, p_user_id, 'run.created', jsonb_build_object('kind', p_kind));

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_find_or_create_browser_run(
  p_id UUID,
  p_user_id TEXT,
  p_project_id TEXT,
  p_conversation_id TEXT
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.action_runs;
BEGIN
  IF p_conversation_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id || ':' || p_conversation_id));
    SELECT * INTO v_run FROM public.action_runs
    WHERE user_id = p_user_id
      AND conversation_id = p_conversation_id
      AND kind = 'browser'
      AND status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN RETURN v_run; END IF;
  END IF;

  INSERT INTO public.action_runs (
    id, user_id, project_id, conversation_id, kind, status, current_activity
  ) VALUES (
    p_id, p_user_id, p_project_id, p_conversation_id, 'browser', 'queued', 'Starting browser session'
  ) RETURNING * INTO v_run;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (v_run.id, p_user_id, 'run.created', jsonb_build_object('kind', 'browser'));
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_append_event(
  p_run_id UUID,
  p_user_id TEXT,
  p_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS public.action_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event public.action_events;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.action_runs
    WHERE id = p_run_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb))
  RETURNING * INTO v_event;
  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_transition(
  p_run_id UUID,
  p_user_id TEXT,
  p_to_status TEXT,
  p_patch JSONB DEFAULT '{}'::jsonb,
  p_event_type TEXT DEFAULT 'run.status',
  p_event_payload JSONB DEFAULT '{}'::jsonb
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current public.action_runs;
  v_updated public.action_runs;
  v_now TIMESTAMPTZ := now();
  v_started_at TIMESTAMPTZ;
  v_completed_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.action_runtime_can_transition(v_current.status, p_to_status) THEN
    RAISE EXCEPTION 'ACTION_RUN_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  -- Same-status calls are valid patches, but never lifecycle events.
  v_started_at := v_current.started_at;
  IF v_current.status = 'queued'
     AND p_to_status IN ('starting', 'working', 'waiting_for_user', 'user_controlling', 'paused')
     AND v_started_at IS NULL THEN
    v_started_at := v_now;
  END IF;
  v_completed_at := v_current.completed_at;
  IF p_to_status IN ('completed', 'failed', 'cancelled') AND v_completed_at IS NULL THEN
    v_completed_at := v_now;
  END IF;
  IF p_to_status NOT IN ('completed', 'failed', 'cancelled') THEN
    v_completed_at := NULL;
  END IF;

  UPDATE public.action_runs SET
    status = p_to_status,
    started_at = v_started_at,
    completed_at = v_completed_at,
    current_activity = CASE WHEN p_patch ? 'currentActivity' THEN p_patch->>'currentActivity' ELSE current_activity END,
    browser_session_id = CASE WHEN p_patch ? 'browserSessionId' THEN NULLIF(p_patch->>'browserSessionId', '')::uuid ELSE browser_session_id END,
    cancellation_requested_at = CASE WHEN p_patch ? 'cancellationRequestedAt' THEN NULLIF(p_patch->>'cancellationRequestedAt', '')::timestamptz ELSE cancellation_requested_at END,
    approval_reference = CASE WHEN p_patch ? 'approvalReference' THEN p_patch->>'approvalReference' ELSE approval_reference END,
    failure_code = CASE WHEN p_patch ? 'failureCode' THEN p_patch->>'failureCode' ELSE failure_code END,
    failure_message = CASE WHEN p_patch ? 'failureMessage' THEN p_patch->>'failureMessage' ELSE failure_message END,
    updated_at = v_now
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;

  IF v_current.status <> p_to_status THEN
    INSERT INTO public.action_events (run_id, user_id, type, payload)
    VALUES (
      p_run_id,
      p_user_id,
      p_event_type,
      COALESCE(p_event_payload, '{}'::jsonb) || jsonb_build_object('status', p_to_status)
    );
  END IF;

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_attach_browser_session(
  p_run_id UUID,
  p_user_id TEXT,
  p_browser_session_id UUID,
  p_provider_session_id TEXT DEFAULT NULL
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current public.action_runs;
  v_updated public.action_runs;
  v_status TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_status := CASE WHEN v_current.status IN ('queued', 'starting') THEN 'working' ELSE v_current.status END;
  UPDATE public.action_runs SET
    browser_session_id = p_browser_session_id,
    status = v_status,
    started_at = CASE WHEN v_current.started_at IS NULL AND v_status <> 'queued' THEN v_now ELSE v_current.started_at END,
    updated_at = v_now,
    current_activity = 'Browser session ready'
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (
    p_run_id,
    p_user_id,
    'browser.session.started',
    jsonb_build_object('browserSessionId', p_browser_session_id, 'providerSessionId', p_provider_session_id)
  );
  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', 'Browser session started'));
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_event_activity(
  p_run_id UUID,
  p_user_id TEXT,
  p_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_message TEXT DEFAULT NULL
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated public.action_runs;
BEGIN
  UPDATE public.action_runs SET current_activity = p_message, updated_at = now()
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb));
  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', p_message));
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_activity(
  p_run_id UUID,
  p_user_id TEXT,
  p_message TEXT
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated public.action_runs;
BEGIN
  UPDATE public.action_runs SET current_activity = p_message, updated_at = now()
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', p_message));
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_request_cancellation(
  p_run_id UUID,
  p_user_id TEXT,
  p_requested_at TIMESTAMPTZ DEFAULT now()
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current public.action_runs;
  v_updated public.action_runs;
BEGIN
  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_current.status IN ('completed', 'failed', 'cancelled')
     OR v_current.cancellation_requested_at IS NOT NULL THEN
    RETURN v_current;
  END IF;

  UPDATE public.action_runs SET
    cancellation_requested_at = p_requested_at,
    updated_at = now()
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (
    p_run_id,
    p_user_id,
    'cancellation.requested',
    jsonb_build_object('requestedAt', p_requested_at)
  );
  RETURN v_updated;
END;
$$;
