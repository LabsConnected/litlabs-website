-- Browser resource lifecycle hardening.
-- Browser facts belong to the owning ActionRun regardless of run.kind.
-- Keep state, current activity, and the domain event in one transaction.

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
    WHEN 'paused' THEN p_to IN ('starting', 'working', 'waiting_for_user', 'user_controlling', 'failed', 'cancelled')
    ELSE FALSE
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
  SELECT * INTO v_current FROM public.action_runs
  WHERE id = p_run_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACTION_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL' USING ERRCODE = 'P0001';
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

-- Make attachment safe for all nonterminal parent kinds and reject conflicting
-- session ownership instead of silently replacing an attached session.
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
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.browser_session_id IS NOT NULL AND v_current.browser_session_id <> p_browser_session_id THEN
    RAISE EXCEPTION 'ACTION_BROWSER_SESSION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.browser_sessions
    WHERE id = p_browser_session_id AND user_id IS DISTINCT FROM p_user_id
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
