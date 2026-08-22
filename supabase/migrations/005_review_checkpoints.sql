-- ============================================
-- Review Checkpoint Table
-- Phase 10 — Studio Control Plane V1
--
-- Forward-only migration. Do NOT modify prior migrations.
-- Run after 004_acceptance_evidence.sql
-- ============================================

-- ─── Review Checkpoints ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  head_sha TEXT NOT NULL,
  working_tree_diff_hash TEXT NOT NULL,
  mutation_evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  check_evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  acceptance_evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  reviewer_user_id TEXT,
  reviewed_at TIMESTAMPTZ,
  review_comments TEXT,
  blockers TEXT[] NOT NULL DEFAULT '{}',
  stale BOOLEAN NOT NULL DEFAULT false,
  stale_reason TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_checkpoints_run ON review_checkpoints(run_id);
CREATE INDEX IF NOT EXISTS idx_review_checkpoints_project ON review_checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_review_checkpoints_decision ON review_checkpoints(decision);
CREATE INDEX IF NOT EXISTS idx_review_checkpoints_stale ON review_checkpoints(stale);
