-- e2e/db/rpc-exec-lockdown.sql — E2E-ONLY stack patch.
-- Applied explicitly to the disposable Supabase stack (local / CI runner)
-- AFTER `supabase start`; deliberately NOT in supabase/migrations so it can
-- never be deployed to a hosted project via `supabase db push`.
-- SECURITY: lock down SECURITY DEFINER functions reachable by PUBLIC/anon/
-- authenticated via PostgREST /rpc/.
--
-- Root cause: functions created with NULL proacl inherit Postgres's implicit
-- PUBLIC EXECUTE default. Any caller holding the anon key could invoke
-- financial mutations (credit mint/drain, reservation tampering), work-queue
-- manipulation, housekeeping routines, and social-counter forgery.
--
-- Fix: revoke EXECUTE from PUBLIC/anon/authenticated on every exposed definer
-- function; grant EXECUTE to service_role explicitly (all legitimate callers
-- are server-side admin clients — verified: zero .rpc() calls in client code).
--
-- Roles touched: PUBLIC, anon, authenticated (revoke); service_role (grant).
-- RLS unchanged. Function bodies unchanged — internal billing flows that run
-- through service_role keep working. Rollback = re-grant EXECUTE to PUBLIC
-- on the functions listed (restores previous implicit exposure).

BEGIN;

-- ── Financial mutations (CRITICAL) ────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.charge_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_bits(uuid, integer, text, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_bits(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_bits(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_available_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_reservations() FROM PUBLIC, anon, authenticated;

-- ── Work queue / runtime mutations (HIGH) ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.action_runtime_create_run(uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_next_work(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_work(uuid, text, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_stale_mission_runs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_mission_run_heartbeat(uuid, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_increment_conversation_revision(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;

-- ── Booking mutations (HIGH) ──────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic(text, uuid, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_booking_overlap(text, timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;

-- ── Social counters (MEDIUM — engagement forgery) ─────────────────────────
REVOKE EXECUTE ON FUNCTION public.increment_comment_likes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_comment_likes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_post_reposts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_post_reposts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_post_saves(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_post_saves(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_post_shares(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_poll_option_votes(uuid) FROM PUBLIC, anon, authenticated;

-- ── Explicit service_role grants (all legitimate callers are server-side) ──
GRANT EXECUTE ON FUNCTION public.charge_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_bits(uuid, integer, text, text, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_bits(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_bits(uuid, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_available_balance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION public.action_runtime_create_run(uuid, text, text, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_work(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_work(uuid, text, jsonb, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stale_mission_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_mission_run_heartbeat(uuid, text, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_increment_conversation_revision(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, uuid, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_booking_overlap(text, timestamp with time zone, timestamp with time zone, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_comment_likes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_comment_likes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_reposts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_post_reposts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_saves(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_post_saves(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_post_shares(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_poll_option_votes(uuid) TO service_role;

-- ── Self-verification: fail the migration if exposure remains ─────────────
DO $$
DECLARE v_exposed int;
BEGIN
  SELECT count(*) INTO v_exposed
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND p.proname IN (
      'charge_credits','refund_credits','reserve_credits','reserve_bits',
      'release_bits','settle_bits','get_available_balance','expire_stale_reservations',
      'action_runtime_create_run','claim_next_work','complete_work',
      'mark_stale_mission_runs','touch_mission_run_heartbeat',
      'try_increment_conversation_revision','purge_expired_data',
      'create_booking_atomic','check_booking_overlap',
      'increment_comment_likes','decrement_comment_likes',
      'increment_post_reposts','decrement_post_reposts',
      'increment_post_saves','decrement_post_saves',
      'increment_post_shares','increment_poll_option_votes')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_exposed > 0 THEN
    RAISE EXCEPTION 'rpc_exec_lockdown incomplete: % definer functions still callable by anon/authenticated', v_exposed;
  END IF;
END $$;

COMMIT;
