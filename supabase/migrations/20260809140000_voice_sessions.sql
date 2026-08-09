-- Voice sessions table
-- Maps voice provider calls (Vapi, Twilio, etc.) to LiTT user context.
-- When a call starts, we create a voice_session linking the provider call ID
-- to the user, their active project, and a conversation. Every subsequent
-- turn from the voice provider references this session to get context
-- without re-resolving the caller.

create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),

  -- Provider identification
  provider text not null,                   -- 'vapi' | 'twilio' | 'reception' | ...
  provider_call_id text not null,           -- Vapi call ID, Twilio CallSid, etc.

  -- LiTT context (resolved at call start from caller phone)
  user_id text,                             -- Clerk user ID
  conversation_id uuid,                     -- studio_conversations.id
  project_id text,                          -- LiTT project ID

  -- Caller info
  caller_phone text,                        -- E.164 normalized
  caller_name text,                         -- display name if known

  -- Call lifecycle
  status text not null default 'active',    -- active | ended | failed
  started_at timestamptz not null default now(),
  ended_at timestamptz,

  -- Metadata (provider-specific payload, never secrets)
  metadata jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One session per provider call
  unique (provider, provider_call_id)
);

create index if not exists voice_sessions_user_idx on public.voice_sessions (user_id);
create index if not exists voice_sessions_status_idx on public.voice_sessions (status);
create index if not exists voice_sessions_call_idx on public.voice_sessions (provider, provider_call_id);

-- updated_at trigger
drop trigger if exists voice_sessions_set_updated_at on public.voice_sessions;
create trigger voice_sessions_set_updated_at
before update on public.voice_sessions
for each row execute function public.set_updated_at();

-- RLS: service role only (these are server-to-server writes)
alter table public.voice_sessions enable row level security;
