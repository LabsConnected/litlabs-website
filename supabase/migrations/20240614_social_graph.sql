-- ============================================
-- LiTree Social Graph + Notifications
-- Run this in Supabase SQL Editor
-- ============================================

-- 1) follows table
CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(follower_id, followee_id)
);

COMMENT ON TABLE public.follows IS 'Social graph: who follows whom';

-- 2) notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('follow','like','comment','repost','mention','agent_update')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('post','comment','user','agent')),
  entity_id TEXT,
  content TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS 'User notification inbox';
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(recipient_id, read_at) WHERE read_at IS NULL;

-- 3) updated_at trigger (reusable)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to connections if it exists
DROP TRIGGER IF EXISTS set_connections_updated_at ON public.connections;
CREATE TRIGGER set_connections_updated_at
  BEFORE UPDATE ON public.connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4) no-self-follow constraint
ALTER TABLE public.follows
  ADD CONSTRAINT follows_no_self
  CHECK (follower_id <> followee_id);

-- 5) GRANTs (critical for PostgREST / API access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.follows_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.notifications_id_seq TO authenticated;

-- 6) RLS policies for follows
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follows_select ON public.follows;
CREATE POLICY follows_select ON public.follows
  FOR SELECT USING (true);

DROP POLICY IF EXISTS follows_insert ON public.follows;
CREATE POLICY follows_insert ON public.follows
  FOR INSERT WITH CHECK (
    follower_id = (SELECT id FROM public.users WHERE clerk_id = auth.uid())
  );

DROP POLICY IF EXISTS follows_delete ON public.follows;
CREATE POLICY follows_delete ON public.follows
  FOR DELETE USING (
    follower_id = (SELECT id FROM public.users WHERE clerk_id = auth.uid())
  );

-- 7) RLS policies for notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (
    recipient_id = (SELECT id FROM public.users WHERE clerk_id = auth.uid())
  );

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT WITH CHECK (true); -- server-side only via admin client

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (
    recipient_id = (SELECT id FROM public.users WHERE clerk_id = auth.uid())
  );

DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE USING (
    recipient_id = (SELECT id FROM public.users WHERE clerk_id = auth.uid())
  );

-- 8) Helper: create notification on follow (trigger)
CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, content)
  VALUES (
    NEW.followee_id,
    NEW.follower_id,
    'follow',
    'user',
    NEW.follower_id::TEXT,
    'started following you'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_on_follow ON public.follows;
CREATE TRIGGER trg_notify_on_follow
  AFTER INSERT ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_follow();
