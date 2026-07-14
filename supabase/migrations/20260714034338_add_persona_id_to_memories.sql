-- Add persona_id to memories so hard-coded personas (littcode, littlebit)
-- can store scoped memories without needing a user_agents row per persona.

ALTER TABLE memories ADD COLUMN IF NOT EXISTS persona_id text;

CREATE INDEX IF NOT EXISTS idx_memories_owner_persona ON memories(owner_id, persona_id);
