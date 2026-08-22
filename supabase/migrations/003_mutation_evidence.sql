-- ============================================
-- Mutation Evidence + Approval Token Tables
-- Phase 6.1 — Studio Control Plane V1
--
-- These tables persist structured evidence for every workspace
-- mutation and approval token. The Changes and Activity panels
-- read from these tables — NOT from chat transcripts.
--
-- Run this in Supabase SQL Editor after the main schema.sql
-- ============================================

-- ─── Mutation Evidence ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mutation_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha_before TEXT NOT NULL,
  head_sha_after TEXT,
  paths TEXT[] NOT NULL DEFAULT '{}',
  before_hashes JSONB NOT NULL DEFAULT '{}',
  after_hashes JSONB NOT NULL DEFAULT '{}',
  diff TEXT,
  working_tree_diff_hash TEXT,
  working_tree_dirty BOOLEAN,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  approval_token_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_mutation_evidence_run ON mutation_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_mutation_evidence_project ON mutation_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_mutation_evidence_status ON mutation_evidence(status);

-- ─── Approval Tokens ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_tokens (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT false,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approval_tokens_run ON approval_tokens(run_id);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_project ON approval_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_approval_tokens_consumed ON approval_tokens(consumed);

-- ─── Run Events (Phase 7 — Activity feed) ───────────────────────

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}',
  evidence_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_project ON run_events(project_id);
CREATE INDEX IF NOT EXISTS idx_run_events_created ON run_events(created_at DESC);

-- ─── Check Evidence (Phase 8 — Checks executor) ────────────────

CREATE TABLE IF NOT EXISTS check_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued',
  exit_code INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  stdout_ref TEXT,
  stderr_ref TEXT,
  skip_reason TEXT,
  failure_reason TEXT,
  head_sha TEXT NOT NULL,
  working_tree_diff_hash TEXT NOT NULL,
  stale BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_check_evidence_run ON check_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_check_evidence_project ON check_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_check_evidence_status ON check_evidence(status);
CREATE INDEX IF NOT EXISTS idx_check_evidence_stale ON check_evidence(stale);

-- ─── Acceptance Evidence (Phase 9 — acceptance verification) ──

CREATE TABLE IF NOT EXISTS acceptance_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  criterion TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued',
  verification_source TEXT,
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  verification_summary TEXT,
  failure_reason TEXT,
  skip_reason TEXT,
  head_sha TEXT NOT NULL,
  working_tree_diff_hash TEXT NOT NULL,
  stale BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_acceptance_evidence_run ON acceptance_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_evidence_project ON acceptance_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_evidence_status ON acceptance_evidence(status);
CREATE INDEX IF NOT EXISTS idx_acceptance_evidence_stale ON acceptance_evidence(stale);
