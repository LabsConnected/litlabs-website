-- Add notification + workspace preference columns to user_preferences.
-- These columns were added to supabase/schema.sql during the deep-scan pass
-- but were never captured as a migration, so a fresh/remote database is
-- missing them and the /api/settings/preferences route fails at runtime.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS notify_discord TEXT,
  ADD COLUMN IF NOT EXISTS notify_alexa BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_autosave BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS workspace_compact BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_live_preview BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS workspace_telemetry BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_default TEXT DEFAULT 'studio';
