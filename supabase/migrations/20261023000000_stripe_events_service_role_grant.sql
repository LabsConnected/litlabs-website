-- Grant service_role direct table privileges on public.stripe_events.
--
-- Rationale: 20260725000000_credit_ledger_beta_pricing.sql creates the table
-- and grants EXECUTE on claim_stripe_event / finalize_stripe_event /
-- release_stripe_event, but never grants table privileges. Those functions
-- are SECURITY INVOKER, so the caller's role must hold
-- SELECT/INSERT/UPDATE/DELETE directly; the webhook route also performs a
-- direct insert (src/app/api/stripe/webhook/route.ts). Hosted environments
-- work today because Supabase default privileges applied GRANT ALL at table
-- creation; environments without that default-privilege posture reproduce
-- "permission denied for table stripe_events" on the webhook claim path.
--
-- Idempotent: GRANT is additive and safe to re-run. On hosted staging this is
-- a NO-OP (service_role already holds ALL); it exists for chain correctness
-- and environment parity. anon/authenticated receive nothing — deny-all RLS
-- policies govern them.
--
-- Rollback (privilege-preserving — runbook §N.1 step 7): capture the
-- pre-state ACL (pg_class.relacl / information_schema.table_privileges)
-- BEFORE applying. To roll back, revoke ONLY the measured delta (post-state
-- minus pre-state, per grantee) — never a blanket REVOKE. Where the delta is
-- empty (hosted staging), rollback is ledger-only:
--   supabase migration repair --status reverted 20261023000000
-- DO NOT unconditionally REVOKE these privileges: they may pre-date this
-- migration.

BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_events TO service_role;
COMMIT;
