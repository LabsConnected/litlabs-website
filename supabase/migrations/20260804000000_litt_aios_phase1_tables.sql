-- LiTT AIOS Phase 1 — agent steps, tool definitions, tool executions,
-- model usage tracking, and audit events.
--
-- These tables complete the agent-run lifecycle: agent_runs already
-- exists (created in earlier migrations). This migration adds the
-- step-level granularity, tool execution records, model usage stats,
-- and a unified audit trail.

-- ─── agent_steps ───────────────────────────────────────────────────
-- Individual steps within an agent run. Each step is a single
-- model call, tool execution, or planning action.
CREATE TABLE IF NOT EXISTS public.agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL DEFAULT 0,
  step_type TEXT NOT NULL CHECK (step_type IN ('plan', 'model_call', 'tool_call', 'approval', 'observation', 'error')),
  title TEXT,
  description TEXT,
  -- Model call details (null for non-model steps)
  model TEXT,
  provider TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  -- Tool call details (null for non-tool steps)
  tool_id TEXT,
  tool_input JSONB,
  tool_output JSONB,
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'awaiting_approval')),
  error_message TEXT,
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  -- Credits consumed by this step
  credits_consumed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run_id ON public.agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_user_id ON public.agent_steps(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_status ON public.agent_steps(status);
CREATE INDEX IF NOT EXISTS idx_agent_steps_created_at ON public.agent_steps(created_at DESC);

-- ─── tool_definitions ──────────────────────────────────────────────
-- Persistent registry of tools available to LiTT. Tools registered
-- in code (litt-intelligence/tool-registry.ts) are mirrored here for
-- audit, permission management, and marketplace discovery.
CREATE TABLE IF NOT EXISTS public.tool_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL CHECK (source IN ('internal', 'mcp', 'openapi', 'marketplace')),
  version TEXT NOT NULL DEFAULT '1.0.0',
  -- Permission level controls who can use this tool
  permission_level TEXT NOT NULL DEFAULT 'read' CHECK (permission_level IN ('read', 'draft', 'workspace-write', 'external-write', 'production', 'financial', 'destructive')),
  risk TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high', 'critical')),
  -- Schema
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_capabilities TEXT[] NOT NULL DEFAULT '{}',
  required_permissions TEXT[] NOT NULL DEFAULT '{}',
  -- Approval policy
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  auto_approve_read_only BOOLEAN NOT NULL DEFAULT true,
  never_allow BOOLEAN NOT NULL DEFAULT false,
  -- Execution
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  idempotent BOOLEAN NOT NULL DEFAULT false,
  read_only BOOLEAN NOT NULL DEFAULT true,
  -- State
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_definitions_permission_level ON public.tool_definitions(permission_level);
CREATE INDEX IF NOT EXISTS idx_tool_definitions_enabled ON public.tool_definitions(enabled);
CREATE INDEX IF NOT EXISTS idx_tool_definitions_source ON public.tool_definitions(source);

-- ─── tool_executions ───────────────────────────────────────────────
-- Record of every tool execution. Linked to agent_steps for runs
-- that are part of an agent execution, or standalone for direct calls.
CREATE TABLE IF NOT EXISTS public.tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id TEXT NOT NULL REFERENCES public.tool_definitions(id) ON DELETE RESTRICT,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.agent_steps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID,
  -- Input/output
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs JSONB,
  -- Approval
  approval_id UUID,
  approved_by UUID REFERENCES public.users(id),
  approved_at TIMESTAMPTZ,
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'denied')),
  error_message TEXT,
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  -- Credits consumed
  credits_consumed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_id ON public.tool_executions(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_run_id ON public.tool_executions(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_user_id ON public.tool_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON public.tool_executions(status);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON public.tool_executions(created_at DESC);

-- ─── model_usage ───────────────────────────────────────────────────
-- Aggregated model usage for billing, analytics, and cost optimization.
-- One row per model call (not per run).
CREATE TABLE IF NOT EXISTS public.model_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.agent_steps(id) ON DELETE CASCADE,
  conversation_id UUID,
  -- Model details
  litt_alias TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  -- Token counts
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  -- Cost
  credits_cost INTEGER NOT NULL DEFAULT 0,
  -- Metadata
  intent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  -- Timing
  latency_ms INTEGER,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_user_id ON public.model_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_model ON public.model_usage(model);
CREATE INDEX IF NOT EXISTS idx_model_usage_provider ON public.model_usage(provider);
CREATE INDEX IF NOT EXISTS idx_model_usage_called_at ON public.model_usage(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_usage_litt_alias ON public.model_usage(litt_alias);

-- ─── audit_events ──────────────────────────────────────────────────
-- Unified audit trail for every significant action: model calls,
-- tool executions, approvals, credit charges, deployments, etc.
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  project_id UUID,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  -- Event classification
  event_type TEXT NOT NULL CHECK (event_type IN (
    'model_call', 'tool_call', 'approval_requested', 'approval_granted',
    'approval_denied', 'credit_reserved', 'credit_settled', 'credit_refunded',
    'deployment', 'git_push', 'file_delete', 'external_message',
    'connection_added', 'connection_removed', 'config_changed',
    'rate_limited', 'fallback_used', 'error', 'custom'
  )),
  event_category TEXT NOT NULL DEFAULT 'info' CHECK (event_category IN ('info', 'warning', 'error', 'critical')),
  -- Details
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Related entities
  related_id UUID,
  related_type TEXT,
  -- IP and user agent for security audit
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON public.audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON public.audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON public.audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_related_id ON public.audit_events(related_id);

-- ─── Row Level Security ────────────────────────────────────────────
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Users can only see their own steps, executions, usage, and audit events
CREATE POLICY "agent_steps_owner_select" ON public.agent_steps
  FOR SELECT USING (user_id = (select id from public.users where clerk_id = auth.jwt() ->> 'sub'));
CREATE POLICY "agent_steps_owner_insert" ON public.agent_steps
  FOR INSERT WITH CHECK (user_id = (select id from public.users where clerk_id = auth.jwt() ->> 'sub'));

CREATE POLICY "tool_definitions_public_select" ON public.tool_definitions
  FOR SELECT USING (true);

CREATE POLICY "tool_executions_owner_select" ON public.tool_executions
  FOR SELECT USING (user_id = (select id from public.users where clerk_id = auth.jwt() ->> 'sub'));
CREATE POLICY "tool_executions_owner_insert" ON public.tool_executions
  FOR INSERT WITH CHECK (user_id = (select id from public.users where clerk_id = auth.jwt() ->> 'sub'));

CREATE POLICY "model_usage_owner_select" ON public.model_usage
  FOR SELECT USING (user_id = (select id from public.users where clerk_id = auth.jwt() ->> 'sub'));

CREATE POLICY "audit_events_owner_select" ON public.audit_events
  FOR SELECT USING (user_id = (select id from public.users where clerk_id = auth.jwt() ->> 'sub'));

-- ─── updated_at triggers ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_steps_updated_at ON public.agent_steps;
CREATE TRIGGER trg_agent_steps_updated_at
  BEFORE UPDATE ON public.agent_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_tool_definitions_updated_at ON public.tool_definitions;
CREATE TRIGGER trg_tool_definitions_updated_at
  BEFORE UPDATE ON public.tool_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
