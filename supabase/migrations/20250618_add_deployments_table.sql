-- ============================================
-- Add deployments table for LiTBiT deploy tracking
-- ============================================
create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  task_id text,
  branch text not null,
  commit_sha text,
  environment text not null check (environment in ('preview', 'staging', 'production')),
  status text not null check (status in ('queued', 'building', 'deploying', 'live', 'failed', 'cancelled')),
  pipeline_url text,
  deploy_url text,
  source text not null check (source in ('gitlab', 'manual', 'deploy-agent', 'vercel')),
  metadata jsonb default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_deployments_created_at on public.deployments(created_at desc);
create index if not exists idx_deployments_status on public.deployments(status);
create index if not exists idx_deployments_environment on public.deployments(environment);

alter table public.deployments enable row level security;
