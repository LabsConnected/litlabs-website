-- Forward-only migration: Create agent_system_notifications
--
-- This table is the canonical home for agent/platform-level alerts (sales,
-- signups, system alerts, marketing). It is SEPARATE from the social/user
-- `public.notifications` table (defined in 20240614030000_social_graph.sql
-- with a `recipient_id` schema) which serves as the user inbox.
--
-- The historical migration 20260116000000_agent_platform_schema.sql originally
-- created a `notifications` table with a `user_id` schema, but on databases
-- where social_graph ran first, that table already existed with `recipient_id`.
-- This forward migration creates the dedicated `agent_system_notifications`
-- table idempotently, safe for:
--   * a completely fresh `supabase db reset` (table doesn't exist yet)
--   * an existing Production database (historical migration already applied,
--     table may or may not exist under the old `notifications` name)
--
-- This migration NEVER renames, deletes, or modifies the canonical
-- `public.notifications` table.

-- ─── 1. Table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_system_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sale', 'signup', 'agent_created', 'system_alert', 'chat', 'marketing')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  channels TEXT[] DEFAULT '{}',
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_agent_system_notifications_type
  ON public.agent_system_notifications(type);

CREATE INDEX IF NOT EXISTS idx_agent_system_notifications_user_id_read
  ON public.agent_system_notifications(user_id, read_at);

-- ─── 3. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_system_notifications ENABLE ROW LEVEL SECURITY;

-- ─── 4. Policies ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS agent_system_notifications_user_isolation
  ON public.agent_system_notifications;
CREATE POLICY agent_system_notifications_user_isolation
  ON public.agent_system_notifications
  FOR ALL USING (user_id = auth.uid()::UUID);

-- ─── 5. Grants ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.agent_system_notifications TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.agent_system_notifications TO service_role;

-- ─── 6. updated_at trigger ─────────────────────────────────────────────────
-- Reuse the shared set_updated_at() function from social_graph if it exists,
-- otherwise create a dedicated one for this table.

DO $$
BEGIN
  -- Ensure the reusable set_updated_at() function exists (defined by
  -- social_graph, but guard in case that migration was edited).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

-- Add an updated_at column only if it doesn't already exist, then attach
-- the trigger. This keeps the table forward-compatible with future
-- updated_at requirements without altering the original column set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_system_notifications'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.agent_system_notifications
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_agent_system_notifications_updated_at
  ON public.agent_system_notifications;
CREATE TRIGGER set_agent_system_notifications_updated_at
  BEFORE UPDATE ON public.agent_system_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
