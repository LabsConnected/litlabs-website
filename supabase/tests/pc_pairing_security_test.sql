-- Pairing database contract. CI runs this after a clean local migration replay.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(28);

SELECT has_table('public', 'pc_pairing_sessions', 'pairing sessions exist');
SELECT ok((SELECT i.indisunique FROM pg_index i
  WHERE i.indexrelid = 'public.pc_pairing_sessions_pairing_id_idx'::regclass),
  'opaque pairing IDs are unique');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.local_devices'::regclass),
  'devices have RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pc_pairing_sessions'::regclass),
  'pairing sessions have RLS enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.local_devices', 'SELECT'),
  'anon cannot read devices');
SELECT ok(NOT has_table_privilege('authenticated', 'public.pc_pairing_sessions', 'SELECT'),
  'authenticated cannot read pairing sessions directly');
SELECT ok(NOT has_table_privilege('anon', 'public.local_devices', 'INSERT'),
  'anon cannot insert devices');
SELECT ok(NOT has_table_privilege('authenticated', 'public.local_devices', 'UPDATE'),
  'authenticated cannot change devices');
SELECT ok(NOT has_table_privilege('anon', 'public.pc_pairing_sessions', 'INSERT'),
  'anon cannot create pairing sessions directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.pc_pairing_sessions', 'UPDATE'),
  'authenticated cannot change pairing sessions directly');
SELECT ok(NOT has_function_privilege('anon',
  'public.claim_pc_pairing(text,text,text,text)', 'EXECUTE'),
  'anon cannot call the claim function');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.complete_pc_pairing(text,uuid)', 'EXECUTE'),
  'authenticated cannot call confirmation directly');
SELECT ok(has_function_privilege('service_role',
  'public.revoke_pc_device(text,uuid)', 'EXECUTE'),
  'service role can call revocation');

SELECT ok(public.issue_pc_pairing('pairing-test-alice', repeat('a', 64),
  '11111111-1111-4111-8111-111111111111') > pg_catalog.clock_timestamp(),
  'issued pairing expires in the future');
SELECT ok(public.claim_pc_pairing(repeat('a', 64), repeat('f', 64), 'test-public-key', 'PC'),
  'first claim wins');
SELECT ok(NOT public.claim_pc_pairing(repeat('a', 64), repeat('f', 64), 'test-public-key', 'PC'),
  'duplicate claim is rejected');
SELECT is((SELECT count(*)::integer FROM public.complete_pc_pairing(
  'pairing-test-bob', '11111111-1111-4111-8111-111111111111')), 0,
  'another user cannot confirm the claim');
SELECT is((SELECT count(*)::integer FROM public.complete_pc_pairing(
  'pairing-test-alice', '11111111-1111-4111-8111-111111111111')), 1,
  'owner can confirm the claim once');
CREATE TEMP TABLE initial_pairing_device AS
  SELECT id FROM public.local_devices WHERE user_id = 'pairing-test-alice' AND fingerprint = repeat('f', 64);
SELECT is((SELECT count(*)::integer FROM public.complete_pc_pairing(
  'pairing-test-alice', '11111111-1111-4111-8111-111111111111')), 0,
  'confirmed claim cannot replay');

DO $$ BEGIN
  PERFORM public.issue_pc_pairing('pairing-test-alice', repeat('b', 64),
    '22222222-2222-4222-8222-222222222222');
  PERFORM public.issue_pc_pairing('pairing-test-alice', repeat('c', 64),
    '33333333-3333-4333-8333-333333333333');
END $$;
SELECT ok(public.claim_pc_pairing(repeat('b', 64), repeat('f', 64), 'test-public-key', 'PC'),
  'pending claim is accepted before revocation');
DO $$ BEGIN PERFORM pg_sleep(0.01); END $$;
SELECT ok(public.revoke_pc_device('pairing-test-alice',
  (SELECT id FROM pg_temp.initial_pairing_device)), 'owner revokes device');
SELECT is((SELECT count(*)::integer FROM public.complete_pc_pairing(
  'pairing-test-alice', '22222222-2222-4222-8222-222222222222')), 0,
  'pre-revocation pending claim cannot restore device');
SELECT ok(NOT public.claim_pc_pairing(repeat('c', 64), repeat('f', 64), 'test-public-key', 'PC'),
  'pre-revocation unclaimed code cannot claim afterward');

DO $$ BEGIN PERFORM pg_sleep(0.01); END $$;
DO $$ BEGIN
  PERFORM public.issue_pc_pairing('pairing-test-alice', repeat('d', 64),
    '44444444-4444-4444-8444-444444444444');
END $$;
SELECT ok(public.claim_pc_pairing(repeat('d', 64), repeat('f', 64), 'test-public-key', 'PC'),
  'fresh post-revocation claim is accepted');
SELECT is((SELECT count(*)::integer FROM public.complete_pc_pairing(
  'pairing-test-alice', '44444444-4444-4444-8444-444444444444')), 1,
  'fresh owner confirmation restores device');
SELECT is((SELECT id::text FROM public.local_devices
  WHERE user_id = 'pairing-test-alice' AND fingerprint = repeat('f', 64)),
  (SELECT id::text FROM pg_temp.initial_pairing_device),
  're-pair preserves the device ID');

DO $$ BEGIN
  PERFORM public.issue_pc_pairing('pairing-test-bob', repeat('e', 64),
    '55555555-5555-4555-8555-555555555555');
END $$;
SELECT ok(NOT public.claim_pc_pairing(repeat('e', 64), repeat('f', 64), 'test-public-key', 'PC'),
  'other owner cannot claim an existing fingerprint');
SELECT ok((SELECT i.indisunique FROM pg_index i
  WHERE i.indexrelid = 'public.local_devices_fingerprint_owner_idx'::regclass),
  'fingerprints are globally unique');

SELECT * FROM finish();
ROLLBACK;
