-- ============================================
-- Idempotent, atomic Stripe coin-pack crediting
-- Prevents duplicate credits when Stripe retries a
-- webhook after a partial failure, and prevents a
-- non-existent wallet from being silently skipped.
-- ============================================

-- Deduplicate coin purchases by Stripe checkout session. A partial unique
-- index (rather than a plain one) so only 'purchase' transactions carrying a
-- stripe_session_id are constrained.
create unique index if not exists uniq_transactions_stripe_session
  on public.transactions ((metadata->>'stripe_session_id'))
  where type = 'purchase' and metadata->>'stripe_session_id' is not null;

-- Credit a coin pack in a single transaction. Safe to call more than once for
-- the same p_stripe_session_id: the balance is incremented and the transaction
-- recorded exactly once.
create or replace function public.credit_coin_pack(
  p_user_id uuid,
  p_coin_amount integer,
  p_stripe_session_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_balance integer;
begin
  -- Idempotency guard: if this session was already credited, return the
  -- current balance without applying the credit again.
  select w.balance into v_new_balance
  from public.wallets w
  where w.user_id = p_user_id;

  if exists (
    select 1
    from public.transactions t
    where t.type = 'purchase'
      and t.metadata->>'stripe_session_id' = p_stripe_session_id
  ) then
    return coalesce(v_new_balance, 0);
  end if;

  -- Atomically create-or-increment the wallet. A missing wallet is created
  -- with the default signup bonus so a purchase before the row exists does not
  -- start the balance from zero.
  insert into public.wallets (user_id, balance, updated_at)
  values (p_user_id, 500 + p_coin_amount, now())
  on conflict (user_id)
  do update set balance = public.wallets.balance + p_coin_amount,
                updated_at = now()
  returning balance into v_new_balance;

  -- The unique index makes this insert the atomic dedup point: a concurrent
  -- duplicate credit rolls back here, leaving exactly one credit committed.
  insert into public.transactions (user_id, type, amount, balance_after, description, metadata)
  values (
    p_user_id,
    'purchase',
    p_coin_amount,
    v_new_balance,
    'Purchased ' || p_coin_amount || ' LiTBit Coins via Stripe',
    jsonb_build_object('stripe_session_id', p_stripe_session_id)
  );

  return v_new_balance;
end;
$$;

grant execute on function public.credit_coin_pack(uuid, integer, text) to service_role;
