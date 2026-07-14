-- Atomic, idempotent wallet adjustments. Only the service role may execute it.
create unique index if not exists transactions_idempotency_key_unique
  on public.transactions ((metadata ->> 'idempotency_key'))
  where metadata ? 'idempotency_key';

create or replace function public.adjust_wallet_balance(
  p_clerk_id text,
  p_amount integer,
  p_type text,
  p_description text,
  p_idempotency_key text
)
returns table(balance integer, previous_balance integer, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_previous integer;
  v_next integer;
  v_existing integer;
begin
  if p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'Invalid wallet adjustment amount';
  end if;
  if p_type not in ('earn', 'spend', 'refund', 'correction', 'purchase') then
    raise exception 'Invalid wallet transaction type';
  end if;
  if length(trim(p_description)) < 3 or length(trim(p_idempotency_key)) < 8 then
    raise exception 'Reason and idempotency key are required';
  end if;

  select u.id into v_user_id
  from public.users u
  where u.clerk_id = p_clerk_id;

  if v_user_id is null then
    raise exception 'User not found';
  end if;

  select t.balance_after into v_existing
  from public.transactions t
  where t.user_id = v_user_id
    and t.metadata ->> 'idempotency_key' = p_idempotency_key
  limit 1;

  if found then
    return query select v_existing, v_existing - p_amount, true;
    return;
  end if;

  insert into public.wallets (user_id, balance)
  values (v_user_id, 500)
  on conflict (user_id) do nothing;

  select w.balance into v_previous
  from public.wallets w
  where w.user_id = v_user_id
  for update;

  v_next := v_previous + p_amount;
  if v_next < 0 then
    raise exception 'Insufficient balance';
  end if;

  update public.wallets
  set balance = v_next,
      updated_at = timezone('utc'::text, now())
  where user_id = v_user_id;

  insert into public.transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    metadata
  ) values (
    v_user_id,
    p_type,
    p_amount,
    v_next,
    trim(p_description),
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );

  return query select v_next, v_previous, false;
end;
$$;

revoke all on function public.adjust_wallet_balance(text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.adjust_wallet_balance(text, integer, text, text, text)
  to service_role;
