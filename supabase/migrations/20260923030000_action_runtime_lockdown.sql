-- Action Runtime lockdown: privilege isolation, structural tenant ownership,
-- canonical event vocabulary, terminal no-op semantics, and queued->paused removal.
--
-- This migration is the authoritative contract for P0-A. All action_runtime_*
-- functions are callable by service_role only; every SECURITY DEFINER body
-- still validates p_user_id itself, and the tables now enforce owner equality
-- structurally so a future bypass cannot corrupt tenant boundaries.

-- ─── 1. Structural event ownership ───────────────────────────────────────────
-- An event's (run_id, user_id) must equal the owning run's (id, user_id).
-- The composite FK makes cross-user event corruption impossible even if a
-- future code path bypasses the RPC layer.
ALTER TABLE public.action_runs
  ADD CONSTRAINT action_runs_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE public.action_events
  DROP CONSTRAINT IF EXISTS action_events_run_id_fkey,
  ADD CONSTRAINT action_events_run_owner_fkey
    FOREIGN KEY (run_id, user_id) REFERENCES public.action_runs(id, user_id)
    ON DELETE CASCADE;

-- ─── 2. Structural browser-session ownership ─────────────────────────────────
-- A run may only attach a browser session owned by the same user. The
-- composite FK enforces it; RPC-level checks stay as defense-in-depth.
ALTER TABLE public.browser_sessions
  ADD CONSTRAINT browser_sessions_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE public.action_runs
  DROP CONSTRAINT IF EXISTS action_runs_browser_session_id_fkey,
  ADD CONSTRAINT action_runs_browser_session_owner_fkey
    FOREIGN KEY (browser_session_id, user_id) REFERENCES public.browser_sessions(id, user_id)
    ON DELETE SET NULL (browser_session_id);

-- ─── 3. Canonical event vocabulary ───────────────────────────────────────────
-- Unknown event types fail at the table level, not just inside the RPCs.
ALTER TABLE public.action_events
  ADD CONSTRAINT action_events_type_check
  CHECK (public.action_runtime_is_event_type(type));

-- ─── 4. Transition semantics ─────────────────────────────────────────────────
-- queued -> paused removed: a run that never executed is not "paused work".
-- Its exits are starting/working (begin) or failed/cancelled (terminate).
CREATE OR REPLACE FUNCTION public.action_runtime_can_transition(p_from TEXT, p_to TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_from = p_to OR (
    (p_from = 'queued'           AND p_to IN ('starting', 'working', 'failed', 'cancelled')) OR
    (p_from = 'starting'         AND p_to IN ('working', 'waiting_for_user', 'paused', 'failed', 'cancelled')) OR
    (p_from = 'working'          AND p_to IN ('waiting_for_user', 'user_controlling', 'paused', 'completed', 'failed', 'cancelled')) OR
    (p_from = 'waiting_for_user' AND p_to IN ('user_controlling', 'working', 'paused', 'failed', 'cancelled')) OR
    (p_from = 'user_controlling' AND p_to IN ('working', 'waiting_for_user', 'paused', 'failed', 'cancelled')) OR
    (p_from = 'paused'           AND p_to IN ('starting', 'working', 'waiting_for_user', 'user_controlling', 'failed', 'cancelled'))
  );
$$;

-- True iff p_patch would change a durable column. Same-value writes are
-- idempotent no-ops, not mutations — used by the terminal guard below.
CREATE OR REPLACE FUNCTION public.action_runtime_patch_is_meaningful(
  p_run public.action_runs,
  p_patch JSONB
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    (p_patch ? 'currentActivity'         AND p_patch->>'currentActivity' IS DISTINCT FROM p_run.current_activity) OR
    (p_patch ? 'browserSessionId'        AND NULLIF(p_patch->>'browserSessionId', '') IS DISTINCT FROM p_run.browser_session_id::text) OR
    (p_patch ? 'cancellationRequestedAt' AND NULLIF(p_patch->>'cancellationRequestedAt', '') IS DISTINCT FROM p_run.cancellation_requested_at::text) OR
    (p_patch ? 'approvalReference'       AND p_patch->>'approvalReference' IS DISTINCT FROM p_run.approval_reference) OR
    (p_patch ? 'failureCode'             AND p_patch->>'failureCode' IS DISTINCT FROM p_run.failure_code) OR
    (p_patch ? 'failureMessage'          AND p_patch->>'failureMessage' IS DISTINCT FROM p_run.failure_message),
    FALSE
  );
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

  -- Terminal immutability with replay semantics: a same-status call carrying
  -- a no-op patch returns the run unchanged (idempotent retry of the call
  -- that terminated it); any other mutation of a terminal run is rejected.
  IF v_current.status IN ('completed', 'failed', 'cancelled') THEN
    IF p_to_status = v_current.status
       AND NOT public.action_runtime_patch_is_meaningful(v_current, p_patch) THEN
      RETURN v_current;
    END IF;
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.action_runtime_can_transition(v_current.status, p_to_status) THEN
    RAISE EXCEPTION 'ACTION_RUN_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  v_started_at := v_current.started_at;
  IF v_current.status = 'queued'
     AND p_to_status IN ('starting', 'working', 'waiting_for_user', 'user_controlling')
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
    IF p_to_status = v_current.status
       AND NOT public.action_runtime_patch_is_meaningful(v_current, p_patch) THEN
      RETURN v_current;
    END IF;
    RAISE EXCEPTION 'ACTION_RUN_TERMINAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.action_runtime_can_transition(v_current.status, p_to_status) THEN
    RAISE EXCEPTION 'ACTION_RUN_INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  v_started_at := v_current.started_at;
  IF v_current.status = 'queued'
     AND p_to_status IN ('starting', 'working', 'waiting_for_user', 'user_controlling')
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

-- ─── 5. event_activity contract ──────────────────────────────────────────────
-- Emits exactly one domain event. p_type may NOT be 'activity.created'
-- (that type is emitted internally — passing it would double-create the same
-- semantic event). p_message NULL means "no activity update": current_activity
-- is untouched and no activity.created event is persisted — never a
-- { message: null } row.
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
  IF p_type = 'activity.created' OR NOT public.action_runtime_is_event_type(p_type) THEN
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

  IF p_message IS NOT NULL THEN
    UPDATE public.action_runs SET current_activity = p_message, updated_at = now()
    WHERE id = p_run_id AND user_id = p_user_id
    RETURNING * INTO v_updated;
  ELSE
    v_updated := v_current;
  END IF;

  INSERT INTO public.action_events (run_id, user_id, type, payload)
  VALUES (p_run_id, p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb));
  IF p_message IS NOT NULL THEN
    INSERT INTO public.action_events (run_id, user_id, type, payload)
    VALUES (p_run_id, p_user_id, 'activity.created', jsonb_build_object('message', p_message));
  END IF;
  RETURN v_updated;
END;
$$;

-- ─── 6. Function privilege lockdown ──────────────────────────────────────────
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Every
-- mutation RPC takes p_user_id, so ANY role with EXECUTE could mutate any
-- tenant's runs. Revoke from PUBLIC/anon/authenticated; grant service_role
-- only (the Next.js admin client).
DO $$
DECLARE
  fn TEXT;
  role_name TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.action_runtime_can_transition(TEXT, TEXT)',
    'public.action_runtime_is_event_type(TEXT)',
    'public.action_runtime_patch_is_meaningful(public.action_runs, JSONB)',
    'public.action_runtime_create_run(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT)',
    'public.action_runtime_find_or_create_browser_run(UUID, TEXT, TEXT, TEXT)',
    'public.action_runtime_append_event(UUID, TEXT, TEXT, JSONB)',
    'public.action_runtime_transition(UUID, TEXT, TEXT, JSONB, TEXT, JSONB)',
    'public.action_runtime_transition_event_activity(UUID, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT)',
    'public.action_runtime_attach_browser_session(UUID, TEXT, UUID, TEXT)',
    'public.action_runtime_event_activity(UUID, TEXT, TEXT, JSONB, TEXT)',
    'public.action_runtime_activity(UUID, TEXT, TEXT)',
    'public.action_runtime_request_cancellation(UUID, TEXT, TIMESTAMPTZ)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn, role_name);
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM service_role', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;
