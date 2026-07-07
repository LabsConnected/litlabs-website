-- ============================================
-- Brain & Project Context for LiTTree
-- Adds structured user facts and per-user
-- project context (replaces localStorage-only).
-- ============================================

-- Structured persistent facts about the user
create table if not exists public.user_brain (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  key text not null,
  value text not null,
  category text not null default 'general',
  confidence numeric default 1.0,
  source text default 'inferred',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, key, category)
);

create index if not exists idx_user_brain_user_category
  on public.user_brain(user_id, category);

-- Per-user project contexts
create table if not exists public.project_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  name text,
  description text,
  stack text,
  goals text,
  repo_url text,
  custom_instructions text,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_project_contexts_user_active
  on public.project_contexts(user_id, is_active);
