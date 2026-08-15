-- Browser Agent Mode — persistent browser sessions and audit trail
--
-- Supports LiTT Browser Agent Mode: LiTT controls a real browser session
-- via Browserbase + Stagehand. Sessions are persistent per user, with
-- cooperative human/agent control and a full audit log of every action.

-- ─── browser_sessions ────────────────────────────────────────────
-- One row per active or recently-active browser session owned by a user.

create table if not exists public.browser_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id text not null,
  project_id text,
  conversation_id text,

  -- Browserbase session identifier for live-view URL and reconnection
  browserbase_session_id text,

  -- Status: active | paused | human_control | agent_control | closed | error
  status text not null default 'active',

  -- Who is currently in control: 'agent' or 'human'
  controller text not null default 'agent',

  -- The goal/task LiTT is working on in this browser session
  task text,

  -- Live-view URL for embedding in Studio
  live_view_url text,

  -- Error message if status = 'error'
  error text,

  -- Metadata (browser settings, model used, etc.)
  metadata jsonb default '{}'::jsonb,

  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  closed_at timestamp with time zone
);

create index if not exists idx_browser_sessions_user_id on public.browser_sessions(user_id);
create index if not exists idx_browser_sessions_status on public.browser_sessions(status);
create index if not exists idx_browser_sessions_created_at on public.browser_sessions(created_at desc);

alter table public.browser_sessions enable row level security;

DROP POLICY IF EXISTS "Users can read own browser sessions" ON public.browser_sessions;
create policy "Users can read own browser sessions"
  on public.browser_sessions
  for select
  using (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can insert own browser sessions" ON public.browser_sessions;
create policy "Users can insert own browser sessions"
  on public.browser_sessions
  for insert
  with check (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own browser sessions" ON public.browser_sessions;
create policy "Users can update own browser sessions"
  on public.browser_sessions
  for update
  using (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can delete own browser sessions" ON public.browser_sessions;
create policy "Users can delete own browser sessions"
  on public.browser_sessions
  for delete
  using (auth.uid()::text = user_id);

-- ─── browser_actions ─────────────────────────────────────────────
-- Audit trail: every browser action performed by LiTT or the human.

create table if not exists public.browser_actions (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references public.browser_sessions(id) on delete cascade,
  user_id text not null,

  -- Who performed the action: 'agent' or 'human'
  actor text not null,

  -- Tool/action name: browser.navigate, browser.click, browser.type, etc.
  action text not null,

  -- Input parameters for the action
  inputs jsonb default '{}'::jsonb,

  -- Result of the action (success/failure, output data)
  success boolean not null default false,
  result jsonb,

  -- Error message if the action failed
  error text,

  -- Screenshot URL (captured on failures or explicitly)
  screenshot_url text,

  -- Duration in milliseconds
  duration_ms integer,

  created_at timestamp with time zone default now()
);

create index if not exists idx_browser_actions_session_id on public.browser_actions(session_id);
create index if not exists idx_browser_actions_user_id on public.browser_actions(user_id);
create index if not exists idx_browser_actions_created_at on public.browser_actions(created_at desc);

alter table public.browser_actions enable row level security;

DROP POLICY IF EXISTS "Users can read own browser actions" ON public.browser_actions;
create policy "Users can read own browser actions"
  on public.browser_actions
  for select
  using (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can insert own browser actions" ON public.browser_actions;
create policy "Users can insert own browser actions"
  on public.browser_actions
  for insert
  with check (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can delete own browser actions" ON public.browser_actions;
create policy "Users can delete own browser actions"
  on public.browser_actions
  for delete
  using (auth.uid()::text = user_id);
