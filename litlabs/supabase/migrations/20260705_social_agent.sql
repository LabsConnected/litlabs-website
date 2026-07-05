-- Social Agent tables for LiTTree SocialPilot
-- brand_profiles, social_posts, content_runs

-- ── brand_profiles ──────────────────────────────────────────────────
create table if not exists public.brand_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  name          text not null,
  website_url   text,
  voice         text default '',
  colors        jsonb default '{}',
  target_audience text default '',
  main_offers   jsonb default '[]',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.brand_profiles enable row level security;

create policy "Users can view own brand profiles"
  on public.brand_profiles for select
  using (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Users can insert own brand profiles"
  on public.brand_profiles for insert
  with check (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Users can update own brand profiles"
  on public.brand_profiles for update
  using (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Service role full access brand_profiles"
  on public.brand_profiles for all
  using (current_setting('role') = 'service_role');

-- ── social_posts ────────────────────────────────────────────────────
create table if not exists public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references public.brand_profiles(id) on delete cascade,
  user_id       text not null,
  platform      text not null check (platform in ('facebook','instagram','linkedin','x','tiktok','reddit','bluesky')),
  caption       text not null default '',
  image_prompt  text default '',
  hashtags      text[] default '{}',
  status        text not null default 'draft' check (status in ('draft','approved','scheduled','posted','failed','rejected')),
  scheduled_at  timestamptz,
  posted_url    text,
  error_message text,
  run_id        uuid,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.social_posts enable row level security;

create policy "Users can view own social posts"
  on public.social_posts for select
  using (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Users can insert own social posts"
  on public.social_posts for insert
  with check (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Users can update own social posts"
  on public.social_posts for update
  using (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Users can delete own social posts"
  on public.social_posts for delete
  using (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Service role full access social_posts"
  on public.social_posts for all
  using (current_setting('role') = 'service_role');

create index idx_social_posts_brand on public.social_posts(brand_id);
create index idx_social_posts_status on public.social_posts(status);
create index idx_social_posts_user on public.social_posts(user_id);

-- ── content_runs ────────────────────────────────────────────────────
create table if not exists public.content_runs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references public.brand_profiles(id) on delete cascade,
  user_id       text not null,
  source_url    text,
  model_used    text,
  prompt        text,
  result        jsonb default '{}',
  post_count    int default 0,
  created_at    timestamptz default now()
);

alter table public.content_runs enable row level security;

create policy "Users can view own content runs"
  on public.content_runs for select
  using (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Users can insert own content runs"
  on public.content_runs for insert
  with check (auth.uid()::text = user_id or current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id);

create policy "Service role full access content_runs"
  on public.content_runs for all
  using (current_setting('role') = 'service_role');
