-- ============================================
-- Acceptance Evidence Tables
-- Phase 9 — Studio Control Plane V1
--
-- Forward-only migration. Do NOT modify 003_mutation_evidence.sql
-- if it has already been applied.
--
-- Run this in Supabase SQL Editor after 003_mutation_evidence.sql
-- ============================================

-- ─── Acceptance Evidence ─────────────────────────────────────────

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
