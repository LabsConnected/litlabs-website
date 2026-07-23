-- ============================================
-- Agent Voice Profiles
-- Per-user voice settings for LiTT and Spark agents.
-- Uses Supabase auth.uid() for RLS since this table
-- stores user preferences directly accessed by the client.
-- ============================================

CREATE TABLE IF NOT EXISTS public.agent_voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id text NOT NULL CHECK (agent_id IN ('litt', 'spark')),
  provider text NOT NULL DEFAULT 'elevenlabs',
  provider_voice_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,

  speed numeric NOT NULL DEFAULT 1.0,
  stability numeric NOT NULL DEFAULT 0.5,
  similarity numeric NOT NULL DEFAULT 0.75,
  style numeric NOT NULL DEFAULT 0.35,
  speaker_boost boolean NOT NULL DEFAULT true,

  auto_speak boolean NOT NULL DEFAULT true,
  allow_interruptions boolean NOT NULL DEFAULT true,
  max_spoken_paragraphs int NOT NULL DEFAULT 3,
  mute_code_and_logs boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS agent_voice_profiles_user_id_idx
  ON public.agent_voice_profiles(user_id);

ALTER TABLE public.agent_voice_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their voice profiles" ON public.agent_voice_profiles;
CREATE POLICY "Users manage their voice profiles"
  ON public.agent_voice_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Default profiles for LiTT
INSERT INTO public.agent_voice_profiles (user_id, agent_id, provider_voice_id, speed, stability, similarity, style, speaker_boost, max_spoken_paragraphs)
SELECT gen_random_uuid(), 'litt', '', 0.92, 0.72, 0.82, 0.22, true, 3
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_voice_profiles WHERE agent_id = 'litt' LIMIT 1
)
ON CONFLICT DO NOTHING;

-- Default profiles for Spark
INSERT INTO public.agent_voice_profiles (user_id, agent_id, provider_voice_id, speed, stability, similarity, style, speaker_boost, max_spoken_paragraphs)
SELECT gen_random_uuid(), 'spark', '', 1.08, 0.40, 0.78, 0.68, true, 2
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_voice_profiles WHERE agent_id = 'spark' LIMIT 1
)
ON CONFLICT DO NOTHING;
