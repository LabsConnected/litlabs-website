-- Action Runtime final gate: retry-safe creation, exact event identity,
-- terminal/event/session invariants, and durable browser-session ownership.

ALTER TABLE public.action_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_runs_user_idempotency_key
  ON public.action_runs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One live browser resource may be attached to exactly one ActionRun.
DROP INDEX IF EXISTS public.idx_action_runs_browser_session;
CREATE UNIQUE INDEX idx_action_runs_browser_session
  ON public.action_runs(browser_session_id)
  WHERE browser_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.action_runtime_is_event_type(p_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN (
    'run.created', 'run.started', 'run.status', 'run.completed', 'run.failed',
    'run.cancelled', 'agent.started', 'agent.status', 'agent.completed',
    'agent.failed', 'browser.session.started', 'browser.session.updated',
    'browser.session.completed', 'browser.session.failed',
    'browser.action.started', 'browser.action.completed',
    'browser.action.failed', 'browser.user_required',
    'browser.user_control_started', 'browser.user_control_returned',
    'approval.required', 'approval.approved', 'approval.rejected',
    'activity.created', 'cancellation.requested', 'deployment.started',
    'deployment.status', 'deployment.completed', 'deployment.failed'
  );
$$;

CREATE OR REPLACE FUNCTION public.action_runtime_create_run(
  p_id UUID,
  p_user_id TEXT,
  p_project_id TEXT,
  p_conversation_id TEXT,
  p_kind TEXT,
  p_current_activity TEXT DEFAULT NULL,
  p_browser_session_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.action_runs;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id || ':' || p_idempotency_key));
    SELECT * INTO v_run FROM public.action_runs
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_run; END IF;
  END IF;

  INSERT INTO public.action_runs (
    id, user_id, project_id, conversation_id, kind, status,
    current_activity, browser_session_id, idempotency_key
  ) VALUES (
    p_id, p_user_id, p_project_id, p_conversation_id, p_kind, 'queued',
    p_current_activity, p_browser_session_id, p_idempotency_key
  ) RETURNING * INTO v_run;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (v_run.id, p_user_id, 'run.created', jsonb_build_object('kind', p_kind));
  RETURN v_run;
EXCEPTION
  WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_run FROM public.action_runs
      WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
      IF FOUND THEN RETURN v_run; END IF;
    END IF;
    RAISE EXCEPTION 'ACTION_RUN_CONFLICT' USING ERRCODE = 'P0001';
END;
$$;

DROP FUNCTION IF EXISTS public.action_runtime_append_event(UUID, TEXT, TEXT, JSONB);
CREATE FUNCTION public.action_runtime_append_event(
  p_run_id UUID,
  p_user_id TEXT,
  p_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event public.action_events;
BEGIN
  IF NOT public.action_runtime_is_event_type(p_type) THEN
    RAISE EXCEPTION 'ACTION_EVENT_INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.action_runs
    WHERE id = p_run_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb))
  RETURNING * INTO v_event;
  RETURN to_jsonb(v_event) || jsonb_build_object('sequence', v_event.sequence::text);
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
  IF NOT public.action_runtime_is_event_type(p_event_type) THEN
    RAISE EXCEPTION 'ACTION_EVENT_INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.action_runtime_can_transition(v_current.status, p_to_status) THEN
    RAISE EXCEPTION 'ACTION_RUN_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

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

CREATE OR REPLACE FUNCTION public.action_runtime_transition_event_activity(
  p_run_id UUID,
  p_user_id TEXT,
  p_to_status TEXT,
  p_patch JSONB DEFAULT '{}'::jsonb,
  p_event_type TEXT DEFAULT 'run.status',
  p_event_payload JSONB DEFAULT '{}'::jsonb,
  p_message TEXT DEFAULT NULL
) RETURNS public.action_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current public.action_runs;
  v_updated public.action_runs;
  v_now TIMESTAMPTZ := now();
  v_started_at TIMESTAMPTZ;
  v_completed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.action_runtime_is_event_type(p_event_type) THEN
    RAISE EXCEPTION 'ACTION_EVENT_INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.action_runtime_can_transition(v_current.status, p_to_status) THEN
    RAISE EXCEPTION 'ACTION_RUN_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

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
    current_activity = COALESCE(p_message, CASE WHEN p_patch ? 'currentActivity' THEN p_patch->>'currentActivity' ELSE current_activity END),
    browser_session_id = CASE WHEN p_patch ? 'browserSessionId' THEN NULLIF(p_patch->>'browserSessionId', '')::uuid ELSE browser_session_id END,
    cancellation_requested_at = CASE WHEN p_patch ? 'cancellationRequestedAt' THEN NULLIF(p_patch->>'cancellationRequestedAt', '')::timestamptz ELSE cancellation_requested_at END,
    approval_reference = CASE WHEN p_patch ? 'approvalReference' THEN p_patch->>'approvalReference' ELSE approval_reference END,
    failure_code = CASE WHEN p_patch ? 'failureCode' THEN p_patch->>'failureCode' ELSE failure_code END,
    failure_message = CASE WHEN p_patch ? 'failureMessage' THEN p_patch->>'failureMessage' ELSE failure_message END,
    updated_at = v_now
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, p_event_type, COALESCE(p_event_payload, '{}'::jsonb) || jsonb_build_object('status', p_to_status));
  IF p_message IS NOT NULL THEN
    INSERT INTO public.action_events (run_id, user_id, type, payload)
    VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', p_message));
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
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.browser_session_id IS NOT NULL AND v_current.browser_session_id <> p_browser_session_id THEN
    RAISE EXCEPTION 'ACTION_BROWSER_SESSION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.browser_sessions
    WHERE id = p_browser_session_id AND user_id IS DISTINCT FROM p_user_id
  ) THEN
    RAISE EXCEPTION 'ACTION_BROWSER_SESSION_OWNER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.action_runs
    WHERE browser_session_id = p_browser_session_id AND id <> p_run_id
  ) THEN
    RAISE EXCEPTION 'ACTION_BROWSER_SESSION_MISMATCH' USING ERRCODE = 'P0001';
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
  v_current public.action_runs;
  v_updated public.action_runs;
BEGIN
  IF NOT public.action_runtime_is_event_type(p_type) THEN
    RAISE EXCEPTION 'ACTION_EVENT_INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.action_runs SET current_activity = p_message, updated_at = now()
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb));
  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', p_message));
  RETURN v_updated;
END;
$$;

DROP FUNCTION IF EXISTS public.action_runtime_activity(UUID, TEXT, TEXT);
CREATE FUNCTION public.action_runtime_activity(
  p_run_id UUID,
  p_user_id TEXT,
  p_message TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current public.action_runs;
  v_updated public.action_runs;
  v_event public.action_events;
BEGIN
  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.action_runs SET current_activity = p_message, updated_at = now()
  WHERE id = p_run_id AND user_id = p_user_id
  RETURNING * INTO v_updated;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', p_message))
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'run', to_jsonb(v_updated),
    'event', to_jsonb(v_event) || jsonb_build_object('sequence', v_event.sequence::text)
  );
END;
$$;
