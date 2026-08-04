-- MISSING MIGRATION: 20260805000000_litt_agent_identity.sql
-- This was never applied to the live Supabase database.
-- Run in Supabase Dashboard → SQL Editor → New query → Run
--
-- After running: the NOTIFY at the end reloads the schema cache automatically.
-- Then redeploy Vercel.
--
-- Idempotent + safe: every ALTER/UPDATE/INDEX checks table AND column existence first.

-- ─── studio_conversations: add active_agent_mode ──────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'studio_conversations'
  ) THEN
    ALTER TABLE public.studio_conversations
      ADD COLUMN IF NOT EXISTS active_agent_mode TEXT NOT NULL DEFAULT 'standard'
      CHECK (active_agent_mode IN ('standard', 'builder', 'research', 'spark'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'studio_conversations'
      AND column_name = 'active_agent_slug'
  ) THEN
    UPDATE public.studio_conversations
    SET active_agent_mode = 'spark'
    WHERE active_agent_slug = 'spark' AND active_agent_mode = 'standard';
  END IF;
END $$;

-- ─── studio_conversation_messages: add agent_mode ─────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'studio_conversation_messages'
  ) THEN
    ALTER TABLE public.studio_conversation_messages
      ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT NULL
      CHECK (agent_mode IS NULL OR agent_mode IN ('standard', 'builder', 'research', 'spark'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'studio_conversation_messages'
      AND column_name = 'agent_slug'
  ) THEN
    UPDATE public.studio_conversation_messages
    SET agent_mode = 'spark'
    WHERE agent_slug = 'spark' AND agent_mode IS NULL;

    UPDATE public.studio_conversation_messages
    SET agent_mode = 'standard'
    WHERE agent_slug IS NOT NULL AND agent_slug != 'spark' AND agent_mode IS NULL;
  END IF;
END $$;

-- ─── agent_runs: add agent_mode ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_runs'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD COLUMN IF NOT EXISTS agent_mode TEXT NOT NULL DEFAULT 'standard'
      CHECK (agent_mode IN ('standard', 'builder', 'research', 'spark'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_runs'
      AND column_name = 'agent_slug'
  ) THEN
    UPDATE public.agent_runs
    SET agent_mode = 'spark'
    WHERE agent_slug = 'spark' AND agent_mode = 'standard';
  END IF;
END $$;

-- ─── agent_steps: add agent_mode (skips if table doesn't exist) ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_steps'
  ) THEN
    ALTER TABLE public.agent_steps
      ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT NULL
      CHECK (agent_mode IS NULL OR agent_mode IN ('standard', 'builder', 'research', 'spark'));
  END IF;
END $$;

-- ─── memories: add agent_mode ─────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'memories'
  ) THEN
    ALTER TABLE public.memories
      ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT NULL
      CHECK (agent_mode IS NULL OR agent_mode IN ('standard', 'builder', 'research', 'spark'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories'
      AND column_name = 'agent_slug'
  ) THEN
    UPDATE public.memories
    SET agent_mode = 'spark'
    WHERE agent_slug = 'spark' AND agent_mode IS NULL;
  END IF;
END $$;

-- ─── Indexes for memory isolation queries ─────────────────────────
-- Each index checks that its specific column exists, not just the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories'
      AND column_name = 'conversation_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_memories_conversation_id
      ON public.memories(conversation_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories'
      AND column_name = 'agent_mode'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_memories_agent_mode
      ON public.memories(agent_mode);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories'
      AND column_name = 'memory_type'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_memories_memory_type
      ON public.memories(memory_type);
  END IF;
END $$;

-- ─── identity_source column ───────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'studio_conversation_messages'
  ) THEN
    ALTER TABLE public.studio_conversation_messages
      ADD COLUMN IF NOT EXISTS identity_source TEXT NOT NULL DEFAULT 'client'
      CHECK (identity_source IN ('client', 'migration_default', 'migration_slug'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'studio_conversation_messages'
      AND column_name = 'agent_slug'
  ) THEN
    UPDATE public.studio_conversation_messages
    SET identity_source = 'migration_slug'
    WHERE agent_mode IS NOT NULL AND identity_source = 'client'
      AND created_at < now() - interval '1 minute';

    UPDATE public.studio_conversation_messages
    SET identity_source = 'migration_default',
        agent_mode = 'standard'
    WHERE agent_slug IS NULL AND agent_mode IS NULL;
  END IF;
END $$;

-- ─── Reload PostgREST schema cache ────────────────────────────────
NOTIFY pgrst, 'reload schema';
