-- ============================================
-- agent_logs.agent_id: DROP NOT NULL
--
-- The original migration (20250101000000_agent_tasks_schema.sql) defined
-- agent_logs.agent_id with a FK to agents(id) ON DELETE SET NULL, which
-- implies the column should be nullable. However, the live Supabase
-- database had agent_id as NOT NULL, causing silent failures in audit
-- logging (growth audit, vapi_file_change_record, etc.) whenever a tool
-- inserted a row with agent_id = null.
--
-- This migration aligns the live schema with the original intent:
-- agent_id is nullable, preserving the ON DELETE SET NULL behavior.
--
-- Applied manually to production on 2026-08-13 during Growth Engine
-- Phase 1a verification. This file exists so a fresh Supabase
-- environment gets the same schema.
-- ============================================

ALTER TABLE public.agent_logs ALTER COLUMN agent_id DROP NOT NULL;
