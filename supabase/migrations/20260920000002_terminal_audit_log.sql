-- Migration: terminal_audit_log
-- Author: LiTT audit fix — 2026-09-20
--
-- Creates a persistent table for terminal command audit entries.
-- Replaces the in-memory auditLog array in terminal-server/security.ts.
-- Only service-role may insert; deny-all RLS blocks all client access.

CREATE TABLE IF NOT EXISTS public.terminal_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      TEXT        NOT NULL,
  session_id   TEXT        NOT NULL,
  command      TEXT        NOT NULL,
  blocked      BOOLEAN     NOT NULL DEFAULT false,
  workspace_id TEXT
);

CREATE INDEX IF NOT EXISTS terminal_audit_log_user_id_idx
  ON public.terminal_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS terminal_audit_log_blocked_idx
  ON public.terminal_audit_log (blocked, created_at DESC)
  WHERE blocked = true;

ALTER TABLE public.terminal_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all client access to terminal audit log"
  ON public.terminal_audit_log
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.terminal_audit_log IS
  'Durable audit trail for terminal commands. Written by terminal-server '
  'service-role only. Client access denied.';
