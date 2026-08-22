-- LiTT inference usage ledger — per-request recording of model usage
-- for entitlement enforcement, billing, and cost analytics.
--
-- Each row = one inference call served by the remote LiTT operator.
-- Used by terminal-server/entitlement.ts to:
--   1. checkCredits()  — aggregate spend against the wallet balance
--   2. recordUsage()   — insert a row after each served inference
--   3. audit/billing   — per-user cost breakdown by model/provider

create table if not exists public.litt_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  -- The Clerk user ID (denormalized for server-side lookups without
  -- a join — terminal-server only has the clerk_id from the JWT)
  clerk_id text not null,
  -- Which model/provider served the request
  provider text not null,          -- 'openrouter', 'openai', 'ollama', etc.
  model text not null,             -- 'anthropic/claude-sonnet-5', etc.
  -- Token usage (from the model result)
  prompt_tokens integer default 0 not null,
  completion_tokens integer default 0 not null,
  total_tokens integer default 0 not null,
  -- Estimated cost in USD (provider-reported or computed)
  cost_usd numeric(10, 6) default 0 not null,
  -- LiTBit coins debited for this call (0 for subscription-included calls)
  coins_debited integer default 0 not null,
  -- The canonical runId from the operator (for cross-surface correlation)
  run_id text,
  -- Mission mode the request ran under
  mode text,
  -- Duration of the inference call in ms
  duration_ms integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexes for common query patterns
create index if not exists idx_litt_usage_user_id on public.litt_usage_ledger(user_id);
create index if not exists idx_litt_usage_clerk_id on public.litt_usage_ledger(clerk_id);
create index if not exists idx_litt_usage_created_at on public.litt_usage_ledger(created_at desc);
create index if not exists idx_litt_usage_model on public.litt_usage_ledger(model);

-- Row-level security: users can only see their own usage
alter table public.litt_usage_ledger enable row level security;
create policy "Users can view own usage"
  on public.litt_usage_ledger for select
  using (clerk_id = current_setting('app.clerk_id', true));

-- The service role (used by terminal-server) bypasses RLS.
