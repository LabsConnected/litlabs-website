-- ============================================
-- Agent-platform performance indexes
-- Adapted 2026-11-15 from Litlabsos SUPABASE_INDEXES.sql (June 2026)
-- ============================================
-- Every June index was verified against the CURRENT schema in this repo
-- (all migrations through 20261111130000). June's agent-platform tables
-- evolved: sessions -> agent_sessions, messages -> conversation_messages,
-- logs -> agent_logs, jobs -> orchestration_jobs; artifacts and events
-- have no successor table. Indexes are only created where the table and
-- columns exist today and an equivalent index is not already present.
--
-- KEPT VERBATIM (table + columns verified in main):
--   idx_users_created_at       public.users(created_at)
--   idx_agents_created_at      public.agents(created_at)
--
-- ADAPTED to successor tables (columns verified; renamed to this repo's
-- per-table naming convention):
--   idx_sessions_created_at (sessions.started_at)
--     -> idx_agent_sessions_created_at   public.agent_sessions(created_at)
--   idx_sessions_agent_id
--     -> idx_agent_sessions_agent_id     public.agent_sessions(agent_id)
--   idx_sessions_user_status (composite)
--     -> idx_agent_sessions_user_status  public.agent_sessions(user_id, status)
--   idx_messages_session_created (composite)
--     -> idx_conversation_messages_conversation_created
--        public.conversation_messages(conversation_id, created_at)
--   idx_logs_level
--     -> idx_agent_logs_level            public.agent_logs(level)
--   idx_jobs_created_at
--     -> idx_orchestration_jobs_created_at  public.orchestration_jobs(created_at)
--   idx_jobs_user_status (composite)
--     -> idx_orchestration_jobs_user_status public.orchestration_jobs(user_id, status)
--
-- DROPPED (22 of the 31 June indexes):
--   Missing column in main's current schema:
--     idx_users_role (users has no role column),
--     idx_agents_created_by, idx_agents_type (agents has neither column),
--     idx_messages_sender_id (conversation_messages has no sender_id),
--     idx_logs_session_id, idx_logs_session_level (agent_logs has no session_id),
--     idx_jobs_agent_id (orchestration_jobs has agent1_id/agent2_id, no agent_id)
--   Missing table in main (no successor):
--     idx_artifacts_session_id, idx_artifacts_agent_id, idx_artifacts_created_at,
--     idx_events_type, idx_events_triggered_by, idx_events_created_at
--   Already covered by an existing index in main:
--     idx_users_email (main already has this name on public.users(email);
--       June's ON (id) variant would silently no-op behind it),
--     idx_sessions_user_id (idx_agent_sessions_user_id),
--     idx_sessions_status (idx_agent_sessions_status),
--     idx_messages_session_id (idx_conversation_messages_conversation_id),
--     idx_messages_created_at (idx_conversation_messages_created_at),
--     idx_logs_agent_id (idx_agent_logs_agent_id),
--     idx_logs_created_at (idx_agent_logs_created_at),
--     idx_jobs_user_id (idx_orchestration_jobs_user_id),
--     idx_jobs_status (idx_orchestration_jobs_status)
-- ============================================

-- Users (kept verbatim from the June pack)
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at DESC);

-- Agents (kept verbatim from the June pack)
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON public.agents(created_at DESC);

-- Agent sessions (adapted from the June "sessions" indexes)
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id ON public.agent_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_created_at ON public.agent_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_status ON public.agent_sessions(user_id, status);

-- Conversation messages (adapted composite from the June "messages" indexes)
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_created ON public.conversation_messages(conversation_id, created_at DESC);

-- Agent logs (adapted from the June "logs" indexes)
CREATE INDEX IF NOT EXISTS idx_agent_logs_level ON public.agent_logs(level);

-- Orchestration jobs (adapted from the June "jobs" indexes)
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_created_at ON public.orchestration_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestration_jobs_user_status ON public.orchestration_jobs(user_id, status);

-- Refresh planner statistics for the tables that gained indexes
ANALYZE public.users;
ANALYZE public.agents;
ANALYZE public.agent_sessions;
ANALYZE public.conversation_messages;
ANALYZE public.agent_logs;
ANALYZE public.orchestration_jobs;
