-- Jarvis conversation memory
-- Persists chat history per user/agent pair for multi-turn context

CREATE TABLE IF NOT EXISTS jarvis_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL DEFAULT 'director',
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jarvis_messages_user_agent 
  ON jarvis_messages (user_id, agent_slug, created_at DESC);

-- Add read column to notifications table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications' AND column_name = 'read'
  ) THEN
    ALTER TABLE notifications ADD COLUMN read BOOLEAN DEFAULT false;
    CREATE INDEX idx_notifications_unread ON notifications (user_id, read) WHERE read = false;
  END IF;
END $$;

-- Push subscriptions for Web Push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (user_id, subscription)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user 
  ON push_subscriptions (user_id);

-- RLS policies
ALTER TABLE jarvis_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own messages
CREATE POLICY jarvis_messages_user_policy ON jarvis_messages
  FOR ALL USING (user_id = current_setting('request.jwt.claims')::json->>'sub');

CREATE POLICY push_subscriptions_user_policy ON push_subscriptions
  FOR ALL USING (user_id = current_setting('request.jwt.claims')::json->>'sub');
