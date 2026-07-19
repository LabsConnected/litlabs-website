CREATE TABLE IF NOT EXISTS public.builder_chat_sessions (
  id UUID PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  pinned BOOLEAN NOT NULL DEFAULT false,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_builder_chat_sessions_user_updated
  ON public.builder_chat_sessions(clerk_user_id, pinned DESC, updated_at DESC);

ALTER TABLE public.builder_chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS builder_chat_sessions_deny_anon ON public.builder_chat_sessions;
CREATE POLICY builder_chat_sessions_deny_anon ON public.builder_chat_sessions
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS builder_chat_sessions_deny_authenticated ON public.builder_chat_sessions;
CREATE POLICY builder_chat_sessions_deny_authenticated ON public.builder_chat_sessions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
