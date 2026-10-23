-- Bridge audit log (shared-brain authorization hardening, 2026-10-22).
--
-- Durable record of every machine-bridge authorization outcome —
-- accepted AND rejected — for endpoints that write user data over a
-- shared HMAC credential (first consumer: POST /api/n8n/memory).
-- Required by the ART-20261022-045 review: an audit trail that exists
-- only in console logs is not an audit trail.
--
-- The log NEVER stores credential secrets or memory/task content:
-- content is represented by a SHA-256 fingerprint + byte length.
-- supplied_user_id is the ID the caller *claimed*; bound_owner_id is
-- the owner the credential is bound to. A mismatch between the two on
-- a rejected_binding row is the forged-ID evidence.
--
-- Access posture mirrors studio_tasks: RLS enabled, anon and
-- authenticated roles denied outright; only service_role (server-side,
-- via supabaseAdmin) reads/writes. Isolation and authorization are
-- enforced in application code (src/lib/bridge-authz.ts).

CREATE TABLE IF NOT EXISTS public.bridge_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    credential_id text,
    bound_owner_id text,
    supplied_user_id text,
    agent_id uuid,
    outcome text NOT NULL CHECK (outcome IN (
        'accepted',
        'rejected_auth',
        'rejected_binding',
        'rejected_agent',
        'rejected_validation',
        'rejected_secret_content',
        'error'
    )),
    reason text NOT NULL,
    content_fingerprint text,
    content_bytes integer,
    idempotency_key text,
    endpoint text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bridge_audit_log_created
    ON public.bridge_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_audit_log_credential
    ON public.bridge_audit_log (credential_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_audit_log_supplied_user
    ON public.bridge_audit_log (supplied_user_id, created_at DESC)
    WHERE supplied_user_id IS NOT NULL;

ALTER TABLE public.bridge_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bridge_audit_log_deny_anon ON public.bridge_audit_log;
CREATE POLICY bridge_audit_log_deny_anon ON public.bridge_audit_log
    FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS bridge_audit_log_deny_authenticated ON public.bridge_audit_log;
CREATE POLICY bridge_audit_log_deny_authenticated ON public.bridge_audit_log
    FOR ALL TO authenticated USING (false) WITH CHECK (false);
