-- Phase 1 schema for personal LiTT agent, memory ownership, and tool approvals.
-- This migration creates ownership records in Supabase while Supermemory holds
-- semantic indexes. Supabase owns the record; Supermemory indexes it for retrieval.

CREATE TABLE IF NOT EXISTS user_agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id text NOT NULL,
    name text NOT NULL DEFAULT 'LiTT Director',
    avatar_url text,
    instructions text NOT NULL DEFAULT 'You are LiTT, a helpful director assistant.',
    model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
    enabled_tools text[] NOT NULL DEFAULT '{}',
    memory_policy jsonb NOT NULL DEFAULT '{}',
    autonomy text NOT NULL DEFAULT 'ask-first' CHECK (autonomy IN ('ask-first', 'safe-actions', 'autonomous')),
    monthly_budget integer NOT NULL DEFAULT 0,
    project_ids uuid[] NOT NULL DEFAULT '{}',
    voice_settings jsonb,
    data_retention_days integer DEFAULT 365,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add columns if table already existed with different schema
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'LiTT Director';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS instructions text NOT NULL DEFAULT 'You are LiTT, a helpful director assistant.';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'google/gemini-2.5-flash';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS enabled_tools text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS memory_policy jsonb NOT NULL DEFAULT '{}';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS autonomy text NOT NULL DEFAULT 'ask-first';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS monthly_budget integer NOT NULL DEFAULT 0;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS project_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS voice_settings jsonb;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS data_retention_days integer DEFAULT 365;
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_agents_owner ON user_agents(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_agents_default_owner ON user_agents(owner_id) WHERE is_default = true;

CREATE TABLE IF NOT EXISTS memories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id text NOT NULL,
    agent_id uuid REFERENCES user_agents(id) ON DELETE SET NULL,
    content text NOT NULL,
    scope text NOT NULL DEFAULT 'profile' CHECK (scope IN ('profile', 'preference', 'agent', 'project', 'conversation', 'temporary')),
    source text,
    source_id text,
    reason text,
    confidence real DEFAULT 1.0,
    expires_at timestamptz,
    supermemory_id text,
    sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
    last_used_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add columns if memories table already existed with different schema
ALTER TABLE memories ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES user_agents(id) ON DELETE SET NULL;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'profile';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS confidence real DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS supermemory_id text;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'pending';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_memories_owner_scope ON memories(owner_id, scope);
CREATE INDEX IF NOT EXISTS idx_memories_supermemory_id ON memories(supermemory_id);
CREATE INDEX IF NOT EXISTS idx_memories_sync_status ON memories(sync_status);

CREATE TABLE IF NOT EXISTS memory_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    permission text NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'write', 'forget')),
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_permissions_memory ON memory_permissions(memory_id);

CREATE TABLE IF NOT EXISTS agent_tool_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES user_agents(id) ON DELETE CASCADE,
    tool_name text NOT NULL,
    level text NOT NULL DEFAULT 'ask' CHECK (level IN ('allow', 'ask', 'project-only', 'deny')),
    project_ids uuid[] NOT NULL DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (agent_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_permissions_agent ON agent_tool_permissions(agent_id);

CREATE TABLE IF NOT EXISTS agent_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES user_agents(id) ON DELETE CASCADE,
    owner_id text NOT NULL,
    action_type text NOT NULL,
    action_payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
    expires_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_owner_status ON agent_approvals(owner_id, status);

CREATE TABLE IF NOT EXISTS agent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES user_agents(id) ON DELETE CASCADE,
    owner_id text NOT NULL,
    project_id uuid,
    mode text NOT NULL,
    input jsonb,
    output jsonb,
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    cost_cents integer DEFAULT 0,
    duration_ms integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add columns if agent_runs table already existed with different schema
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output jsonb;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'running';
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cost_cents integer DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS duration_ms integer;

CREATE INDEX IF NOT EXISTS idx_agent_runs_owner ON agent_runs(owner_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);

-- RLS policies for service-role server routes (bypasses RLS; authentication handled by Clerk)
ALTER TABLE user_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_user_agents ON user_agents;
CREATE POLICY service_role_all_user_agents ON user_agents FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_memories ON memories;
CREATE POLICY service_role_all_memories ON memories FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_memory_permissions ON memory_permissions;
CREATE POLICY service_role_all_memory_permissions ON memory_permissions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_agent_tool_permissions ON agent_tool_permissions;
CREATE POLICY service_role_all_agent_tool_permissions ON agent_tool_permissions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_agent_approvals ON agent_approvals;
CREATE POLICY service_role_all_agent_approvals ON agent_approvals FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_agent_runs ON agent_runs;
CREATE POLICY service_role_all_agent_runs ON agent_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
