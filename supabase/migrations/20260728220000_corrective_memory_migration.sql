-- ============================================
-- Corrective memory migration
--
-- 1. Backfill project_id for memories that have conversation_id but no project_id
-- 2. Add FK constraint: memories.conversation_id → studio_conversations(id)
-- 3. Add FK constraint: memories.project_id → projects(id) (if studio_projects doesn't exist)
-- 4. Add NOT NULL constraint on memories.owner_id (already enforced by app, make it DB-level)
-- 5. Backfill conversation_id from studio_conversation_messages for existing memories
-- ============================================

-- 1. Backfill project_id from studio_conversations when conversation_id is set
UPDATE memories m
SET project_id = sc.project_id
FROM studio_conversations sc
WHERE m.conversation_id = sc.id
  AND m.project_id IS NULL;

-- 2. Backfill project_id from studio_conversation_messages when conversation_id matches a message
UPDATE memories m
SET project_id = sm.project_id,
    conversation_id = sm.conversation_id
FROM studio_conversation_messages sm
WHERE m.conversation_id = sm.id
  AND m.project_id IS NULL;

-- 3. Add FK constraint on conversation_id → studio_conversations(id)
-- First drop any existing constraint (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'memories_conversation_id_fkey'
      AND table_name = 'memories'
  ) THEN
    ALTER TABLE memories DROP CONSTRAINT memories_conversation_id_fkey;
  END IF;
END $$;

-- Add FK only if the column type is uuid (studio_conversations.id is uuid)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'conversation_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.studio_conversations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Add FK constraint on project_id → projects(id)
-- Use the legacy projects table since that's what resolveProject checks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'memories_project_id_fkey'
      AND table_name = 'memories'
  ) THEN
    ALTER TABLE memories DROP CONSTRAINT memories_project_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'project_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 5. Add check constraint: owner_id must not be empty
ALTER TABLE memories ADD CONSTRAINT memories_owner_id_not_empty
  CHECK (owner_id IS NOT NULL AND owner_id <> '');
