-- LiTT Verification Foundation (PASS 2) — durable proof ledger.
--
-- Doctrine: "UI and narration are projections — not truth.
-- External reality, durable events, and evidence determine truth."
-- Unknown is NEVER success. No valid persisted evidence = no PASS.
--
-- Verification attaches to action_runs.id (the canonical operational
-- execution identity). There is deliberately NO verification_runs table and
-- NO verification_events table: lifecycle events reuse action_events so
-- ordering is preserved through the existing global sequence.
--
-- RLS follows the action_runtime convention: service_role has full access;
-- authenticated users may read rows they own.

-- ─── 1. verification_plans ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verification_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  mission_run_id UUID NULL REFERENCES public.mission_runs(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'evaluating', 'decided', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_plans_action_run
  ON public.verification_plans(action_run_id);
CREATE INDEX IF NOT EXISTS idx_verification_plans_user_created
  ON public.verification_plans(user_id, created_at DESC);
ALTER TABLE public.verification_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_plans ON public.verification_plans;
CREATE POLICY service_role_all_verification_plans ON public.verification_plans
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_plans ON public.verification_plans;
CREATE POLICY users_read_own_verification_plans ON public.verification_plans
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 2. verification_checks ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verification_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.verification_plans(id) ON DELETE CASCADE,
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'passed', 'failed', 'blocked', 'inconclusive', 'skipped')),
  skip_reason TEXT NULL,
  blocked_by TEXT NULL,
  requires_mutation BOOLEAN NOT NULL DEFAULT false,
  max_evidence_age_ms BIGINT NULL,
  narration_satisfies BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, key)
);
CREATE INDEX IF NOT EXISTS idx_verification_checks_plan
  ON public.verification_checks(plan_id);
CREATE INDEX IF NOT EXISTS idx_verification_checks_action_run
  ON public.verification_checks(action_run_id);
ALTER TABLE public.verification_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_checks ON public.verification_checks;
CREATE POLICY service_role_all_verification_checks ON public.verification_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_checks ON public.verification_checks;
CREATE POLICY users_read_own_verification_checks ON public.verification_checks
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 3. verification_attempts ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES public.verification_checks(id) ON DELETE CASCADE,
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  executor TEXT NOT NULL,
  command_identity TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  exit_code INTEGER NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_attempts_check
  ON public.verification_attempts(check_id);
CREATE INDEX IF NOT EXISTS idx_verification_attempts_action_run
  ON public.verification_attempts(action_run_id);
ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_attempts ON public.verification_attempts;
CREATE POLICY service_role_all_verification_attempts ON public.verification_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_attempts ON public.verification_attempts;
CREATE POLICY users_read_own_verification_attempts ON public.verification_attempts
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 4. verification_evidence ───────────────────────────────────────
-- Every durable evidence payload carries: schema_version, evidence_type,
-- source, collected_at, action_run_id, claim, assertion data, integrity
-- metadata, and artifact references. Secrets are redacted BEFORE insert
-- (application contract; redacted=true marks the guarantee).
CREATE TABLE IF NOT EXISTS public.verification_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  check_id UUID NULL REFERENCES public.verification_checks(id) ON DELETE CASCADE,
  attempt_id UUID NULL REFERENCES public.verification_attempts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('machine', 'agent', 'human', 'system')),
  collected_at TIMESTAMPTZ NOT NULL,
  claim TEXT NOT NULL,
  assertion JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity JSONB NOT NULL DEFAULT '{}'::jsonb,
  redacted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_evidence_action_run
  ON public.verification_evidence(action_run_id);
CREATE INDEX IF NOT EXISTS idx_verification_evidence_check
  ON public.verification_evidence(check_id);
CREATE INDEX IF NOT EXISTS idx_verification_evidence_attempt
  ON public.verification_evidence(attempt_id);
ALTER TABLE public.verification_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_evidence ON public.verification_evidence;
CREATE POLICY service_role_all_verification_evidence ON public.verification_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_evidence ON public.verification_evidence;
CREATE POLICY users_read_own_verification_evidence ON public.verification_evidence
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 5. verification_artifacts ──────────────────────────────────────
-- Content-addressed by sha256. Payloads stored here are already redacted.
CREATE TABLE IF NOT EXISTS public.verification_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 TEXT NOT NULL UNIQUE,
  byte_size BIGINT NOT NULL,
  content_type TEXT NULL,
  storage_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_artifacts_sha256
  ON public.verification_artifacts(sha256);
ALTER TABLE public.verification_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_artifacts ON public.verification_artifacts;
CREATE POLICY service_role_all_verification_artifacts ON public.verification_artifacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Artifacts are content-addressed and redacted at write time; any
-- authenticated reader may resolve a hash they already hold.
DROP POLICY IF EXISTS authenticated_read_verification_artifacts ON public.verification_artifacts;
CREATE POLICY authenticated_read_verification_artifacts ON public.verification_artifacts
  FOR SELECT TO authenticated USING (true);

-- ─── 6. verification_artifact_links ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verification_artifact_links (
  evidence_id UUID NOT NULL REFERENCES public.verification_evidence(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES public.verification_artifacts(id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, artifact_id)
);
ALTER TABLE public.verification_artifact_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_artifact_links ON public.verification_artifact_links;
CREATE POLICY service_role_all_verification_artifact_links ON public.verification_artifact_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS authenticated_read_verification_artifact_links ON public.verification_artifact_links;
CREATE POLICY authenticated_read_verification_artifact_links ON public.verification_artifact_links
  FOR SELECT TO authenticated USING (true);

-- ─── 7. verification_verdicts ────────────────────────────────────────
-- Verdicts are DERIVED records: they name the evidence they were derived
-- from but are never themselves the authoritative source of success.
CREATE TABLE IF NOT EXISTS public.verification_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  plan_id UUID NULL REFERENCES public.verification_plans(id) ON DELETE CASCADE,
  check_id UUID NULL REFERENCES public.verification_checks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  verdict TEXT NOT NULL
    CHECK (verdict IN ('pass', 'fail', 'blocked', 'inconclusive')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_verification_verdicts_action_run
  ON public.verification_verdicts(action_run_id);
CREATE INDEX IF NOT EXISTS idx_verification_verdicts_plan
  ON public.verification_verdicts(plan_id);
ALTER TABLE public.verification_verdicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_verdicts ON public.verification_verdicts;
CREATE POLICY service_role_all_verification_verdicts ON public.verification_verdicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_verdicts ON public.verification_verdicts;
CREATE POLICY users_read_own_verification_verdicts ON public.verification_verdicts
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 8. verification_failures ────────────────────────────────────────
-- Durable, inspectable failure records. Failures never disappear.
CREATE TABLE IF NOT EXISTS public.verification_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  attempt_id UUID NULL REFERENCES public.verification_attempts(id) ON DELETE CASCADE,
  check_id UUID NULL REFERENCES public.verification_checks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_failures_action_run
  ON public.verification_failures(action_run_id);
CREATE INDEX IF NOT EXISTS idx_verification_failures_check
  ON public.verification_failures(check_id);
ALTER TABLE public.verification_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_failures ON public.verification_failures;
CREATE POLICY service_role_all_verification_failures ON public.verification_failures
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_failures ON public.verification_failures;
CREATE POLICY users_read_own_verification_failures ON public.verification_failures
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 9. verification_quarantine ──────────────────────────────────────
-- Invalid evidence is quarantined, never silently dropped or "fixed".
CREATE TABLE IF NOT EXISTS public.verification_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  evidence_id UUID NULL REFERENCES public.verification_evidence(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('schema_invalid', 'hash_mismatch', 'corrupt', 'impossible', 'untrusted', 'secret_detected')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_quarantine_action_run
  ON public.verification_quarantine(action_run_id);
ALTER TABLE public.verification_quarantine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_quarantine ON public.verification_quarantine;
CREATE POLICY service_role_all_verification_quarantine ON public.verification_quarantine
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_quarantine ON public.verification_quarantine;
CREATE POLICY users_read_own_verification_quarantine ON public.verification_quarantine
  FOR SELECT USING (auth.uid()::text = user_id);

-- ─── 10. verification_policy_snapshots ───────────────────────────────
-- The policy inputs a verdict was derived from, frozen at decision time.
CREATE TABLE IF NOT EXISTS public.verification_policy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.verification_plans(id) ON DELETE CASCADE,
  action_run_id UUID NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  policy JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_policy_snapshots_plan
  ON public.verification_policy_snapshots(plan_id);
ALTER TABLE public.verification_policy_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_verification_policy_snapshots ON public.verification_policy_snapshots;
CREATE POLICY service_role_all_verification_policy_snapshots ON public.verification_policy_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS users_read_own_verification_policy_snapshots ON public.verification_policy_snapshots;
CREATE POLICY users_read_own_verification_policy_snapshots ON public.verification_policy_snapshots
  FOR SELECT USING (auth.uid()::text = user_id);
