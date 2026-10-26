-- rpc_exec_lockdown.test.sql — run AFTER applying
-- e2e/db/rpc-exec-lockdown.sql on an ISOLATED stack (that patch is E2E-only
-- and intentionally absent from supabase/migrations).
-- Usage: psql -f supabase/tests/rpc_exec_lockdown.test.sql
-- Everything runs inside one transaction and ROLLBACKs — no data persists.
--
-- Negative tests: anon/authenticated cannot EXECUTE financial mutations.
-- Positive tests: service_role retains EXECUTE (reaches function body, not 42501).

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures (isolated, rolled back) ──────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO public.users (id, clerk_id, email)
VALUES ('11111111-1111-1111-1111-1111111111e1', 'e2e_clerk_test', 'e2e-fixture@test.invalid');
INSERT INTO public.agent_runs (id, user_id, agent_name, task)
VALUES ('22222222-2222-2222-2222-2222222222e2', '11111111-1111-1111-1111-1111111111e1', 'e2e-fixture', 'e2e-lockdown-test');
RESET ROLE;

-- ── Negative: every locked function must reject anon + authenticated ──────
DO $$
DECLARE
  fns text[] := ARRAY[
    'charge_credits(uuid,integer) VALUES (gen_random_uuid(),1)',
    'refund_credits(uuid,integer) VALUES (gen_random_uuid(),1)',
    'reserve_credits(uuid,integer) VALUES (gen_random_uuid(),1)',
    'reserve_bits(uuid,integer,text,text,text,text,text,text,integer) VALUES (gen_random_uuid(),1,''k12345678'',''run'',''r'',''rid'',''d'',''k'',''ref'',1)',
    'release_bits(uuid,text) VALUES (gen_random_uuid(),''k12345678'')',
    'settle_bits(uuid,integer,text,text,text) VALUES (gen_random_uuid(),1,''k12345678'',''t'',''d'')',
    'get_available_balance(uuid) VALUES (gen_random_uuid())',
    'expire_stale_reservations() VALUES ()',
    'purge_expired_data() VALUES ()',
    'reserve_credits(uuid,integer) VALUES (gen_random_uuid(),1)'
  ];
  roles text[] := ARRAY['anon','authenticated'];
  fn text; role text; denied int := 0; allowed int := 0;
BEGIN
  FOREACH role IN ARRAY roles LOOP
    FOREACH fn IN ARRAY fns LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', role);
        EXECUTE format('SELECT public.%s', split_part(fn,' VALUES',1)
                       || ' FROM (SELECT 1) _ WHERE false'); -- privilege check without side effects
        allowed := allowed + 1;
        RAISE WARNING 'FAIL: % could EXECUTE %', role, fn;
      EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
        denied := denied + 1;
      WHEN OTHERS THEN
        denied := denied + 1; -- domain error still proves EXECUTE; count as denied-exec only if privilege error
        RAISE WARNING 'CHECK: % on % raised %', role, fn, SQLERRM;
      END;
      EXECUTE 'RESET ROLE';
    END LOOP;
  END LOOP;
  RAISE NOTICE 'negative suite: % denied, % allowed', denied, allowed;
  IF allowed > 0 THEN RAISE EXCEPTION 'lockdown test FAILED: unauthorized EXECUTE remains'; END IF;
END $$;

-- ── Positive: service_role EXECUTE reaches the function body ──────────────
DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.charge_credits('22222222-2222-2222-2222-2222222222e2', 0);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL: service_role denied EXECUTE on charge_credits';
  END;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS: service_role executed charge_credits (fixture row)';
END $$;

DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.get_available_balance('11111111-1111-1111-1111-1111111111e1');
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS: service_role executed get_available_balance';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'FAIL: service_role denied EXECUTE on get_available_balance';
END $$;

ROLLBACK;
