-- ============================================
-- LiT memory aging + persisted personality state
-- 1. Adds relevance/aging columns to user_brain so
--    memory can be prioritized and softly forgotten.
-- 2. Adds lit_state: a small per-user personality/mood
--    state (rapport / energy / momentum) that persists
--    across sessions and subtly shapes LiT's tone.
-- ============================================

-- 1. Memory aging / relevance on structured facts
alter table public.user_brain
  add column if not exists last_used_at timestamp with time zone
    default timezone('utc'::text, now());

alter table public.user_brain
  add column if not exists usage_count integer not null default 0;

create index if not exists idx_user_brain_relevance
  on public.user_brain(user_id, confidence desc, last_used_at desc);

-- 2. Persisted LiT personality/mood state
create table if not exists public.lit_state (
  user_id text primary key references public.users(id) on delete cascade,
  rapport integer not null default 50,
  energy integer not null default 70,
  momentum integer not null default 50,
  interactions integer not null default 0,
  last_mood text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
