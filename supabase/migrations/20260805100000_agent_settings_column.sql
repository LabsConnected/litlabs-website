-- Add agent_settings JSONB column to user_preferences
-- Stores LiTT & Spark agent configuration (tool permissions, behavior, response style)
--
-- The settings page saves to localStorage immediately and also POSTs to
-- /api/settings/agents which persists to this column. If the column doesn't
-- exist yet, the API route falls back gracefully (localStorage is source of truth).

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS agent_settings JSONB DEFAULT NULL;

COMMENT ON COLUMN user_preferences.agent_settings IS
  'JSON blob of LiTT & Spark agent settings: defaultAgent, responseStyle, spokenLength, approvalRequired, projectAwareness, memoryUsage, proactiveSuggestions, terminalAccess, fileWrite, githubAccess, deployApproval';
