-- Add phone column to users table for voice-bridge caller identification.
--
-- The LiTT Voice Bridge looks up users by their Twilio Caller ID (phone
-- number). This column stores the user's phone in E.164 format so the
-- voice bridge can resolve a caller to their clerk_id and build full
-- LittUserContext via the Context Engine.
--
-- Phone is optional — users who never call LiTT don't need one set.
-- When set, it must be unique (one user per phone number).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone) WHERE phone IS NOT NULL;
