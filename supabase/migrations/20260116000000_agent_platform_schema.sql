-- LiTTree Agent Platform Schema
-- Run this in Supabase SQL Editor

-- Conversations for agent chat persistence
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages within conversations
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-time agent sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'busy', 'offline', 'error')),
  socket_id TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, user_id)
);

-- Agent analytics
CREATE TABLE IF NOT EXISTS agent_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  messages_sent INTEGER DEFAULT 0,
  messages_received INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  unique_users INTEGER DEFAULT 0,
  user_rating_avg DECIMAL(3,2),
  total_conversations INTEGER DEFAULT 0,
  UNIQUE(agent_id, date)
);

-- Notifications system (Jarvis)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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

-- Agent sales marketplace
CREATE TABLE IF NOT EXISTS agent_sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES users(id) ON DELETE SET NULL,
  price_lbc INTEGER NOT NULL,
  price_usd_cents INTEGER,
  platform_fee_lbc INTEGER DEFAULT 0,
  seller_earnings_lbc INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creator earnings tracking
CREATE TABLE IF NOT EXISTS creator_earnings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  sales_count INTEGER DEFAULT 0,
  total_earnings_lbc INTEGER DEFAULT 0,
  total_earnings_usd_cents INTEGER DEFAULT 0,
  platform_fees_lbc INTEGER DEFAULT 0,
  withdrawn_lbc INTEGER DEFAULT 0,
  available_lbc INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- Agent reviews
CREATE TABLE IF NOT EXISTS agent_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, user_id)
);

-- CLI Bridge sessions (for terminal access)
CREATE TABLE IF NOT EXISTS cli_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('qwen', 'hermes', 'openclaw', 'gemini', 'terminal')),
  session_token TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'error')),
  command_history JSONB DEFAULT '[]',
  output_buffer TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_agent_sales_buyer_id ON agent_sales(buyer_id);
CREATE INDEX IF NOT EXISTS idx_agent_sales_seller_id ON agent_sales(seller_id);
CREATE INDEX IF NOT EXISTS idx_agent_sales_created_at ON agent_sales(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_agent_id ON agent_reviews(agent_id);

-- RLS Policies
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE cli_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY conversations_user_isolation ON conversations
  FOR ALL USING (user_id = auth.uid()::UUID);

CREATE POLICY conversation_messages_user_isolation ON conversation_messages
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()::UUID
    )
  );

CREATE POLICY notifications_user_isolation ON notifications
  FOR ALL USING (user_id = auth.uid()::UUID);

CREATE POLICY agent_sales_buyer_isolation ON agent_sales
  FOR SELECT USING (buyer_id = auth.uid()::UUID OR seller_id = auth.uid()::UUID);

CREATE POLICY creator_earnings_user_isolation ON creator_earnings
  FOR ALL USING (user_id = auth.uid()::UUID);

CREATE POLICY agent_reviews_user_isolation ON agent_reviews
  FOR ALL USING (user_id = auth.uid()::UUID);

CREATE POLICY cli_sessions_user_isolation ON cli_sessions
  FOR ALL USING (user_id = auth.uid()::UUID);

-- Public reads for analytics (aggregated only)
CREATE POLICY agent_analytics_public ON agent_analytics
  FOR SELECT USING (true);

-- Functions for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update creator earnings when sale happens
CREATE OR REPLACE FUNCTION update_creator_earnings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO creator_earnings (user_id, date, sales_count, total_earnings_lbc, platform_fees_lbc, available_lbc)
  VALUES (NEW.seller_id, CURRENT_DATE, 1, NEW.seller_earnings_lbc, NEW.platform_fee_lbc, NEW.seller_earnings_lbc)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    sales_count = creator_earnings.sales_count + 1,
    total_earnings_lbc = creator_earnings.total_earnings_lbc + NEW.seller_earnings_lbc,
    platform_fees_lbc = creator_earnings.platform_fees_lbc + NEW.platform_fee_lbc,
    available_lbc = creator_earnings.available_lbc + NEW.seller_earnings_lbc;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_update_creator_earnings
  AFTER INSERT ON agent_sales
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND NEW.seller_id IS NOT NULL)
  EXECUTE FUNCTION update_creator_earnings();
