-- LiTT Intelligence: Structured Project Knowledge
--
-- Extends the existing memories system with structured knowledge
-- categories, verification status, confidence scoring, and
-- supersession tracking.
--
-- This table is SEPARATE from the existing memories table — it stores
-- structured project intelligence, not conversation summaries.
-- Conversation summaries remain in the memories table.

CREATE TABLE IF NOT EXISTS project_knowledge (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,

  -- Knowledge category (from the canonical type system)
  category TEXT NOT NULL CHECK (
    category IN (
      'architecture_fact',
      'dependency_fact',
      'integration_fact',
      'capability_fact',
      'decision',
      'constraint',
      'user_preference',
      'known_issue',
      'failed_attempt',
      'successful_pattern',
      'research_finding',
      'security_risk',
      'release_state',
      'open_question'
    )
  ),

  -- The actual knowledge content
  content TEXT NOT NULL,

  -- Provenance — where this knowledge came from
  source_type TEXT NOT NULL CHECK (
    source_type IN ('repository', 'probe', 'research', 'conversation', 'manual')
  ),
  source_reference TEXT NOT NULL,
  source_revision TEXT,

  -- Confidence and verification
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_status IN ('verified', 'unverified', 'superseded', 'stale')
  ),

  -- Staleness and expiration
  expires_at TIMESTAMPTZ,
  superseded_by TEXT REFERENCES project_knowledge(id),

  -- Arbitrary metadata (JSON, never contains secrets)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_knowledge_owner_project
  ON project_knowledge(owner_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_category
  ON project_knowledge(category);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_verification
  ON project_knowledge(verification_status);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_updated
  ON project_knowledge(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_superseded
  ON project_knowledge(superseded_by)
  WHERE superseded_by IS NOT NULL;

-- RLS: Users can only access their own project knowledge
ALTER TABLE project_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_knowledge_owner_select
  ON project_knowledge FOR SELECT
  USING (auth.jwt() ->> 'sub' = owner_id);

CREATE POLICY project_knowledge_owner_insert
  ON project_knowledge FOR INSERT
  WITH CHECK (auth.jwt() ->> 'sub' = owner_id);

CREATE POLICY project_knowledge_owner_update
  ON project_knowledge FOR UPDATE
  USING (auth.jwt() ->> 'sub' = owner_id)
  WITH CHECK (auth.jwt() ->> 'sub' = owner_id);

CREATE POLICY project_knowledge_owner_delete
  ON project_knowledge FOR DELETE
  USING (auth.jwt() ->> 'sub' = owner_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_project_knowledge_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_knowledge_updated_at
  BEFORE UPDATE ON project_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION update_project_knowledge_timestamp();
