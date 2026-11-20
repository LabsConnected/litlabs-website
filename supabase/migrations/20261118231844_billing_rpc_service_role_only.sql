-- Billing RPCs are SECURITY DEFINER, so table RLS does not protect callers.
-- Restrict only known wallet, reservation and purchase functions. The owner
-- and superusers retain PostgreSQL's inherent privileges; application calls
-- must use service_role.
DO $billing_rpc_lockdown$
DECLARE
  target record;
  grantee_name text;
  function_signature text;
  required_name text;
  table_name text;
  protected_names text[] := ARRAY[
    'adjust_wallet_balance',
    'charge_credits', 'reserve_credits', 'refund_credits',
    'grant_credits', 'debit_credits', 'get_user_balances',
    'get_available_balance', 'reserve_bits', 'settle_bits',
    'release_bits', 'expire_stale_reservations',
    'create_pending_agent_order', 'fulfill_agent_purchase',
    'refund_agent_purchase', 'expire_pending_order'
  ];
  -- RLS does not govern TRUNCATE. Historic table grants exposed this command
  -- to API roles on the financial ledger and its supporting evidence tables.
  protected_tables text[] := ARRAY[
    'agent_entitlements', 'agent_runs', 'api_key_usage',
    'billing_reconciliations', 'credit_grants', 'credit_ledger',
    'credit_reservations', 'llm_usage_records', 'marketplace_order_items',
    'marketplace_orders', 'model_usage', 'stripe_events',
    'terminal_usage', 'transactions', 'usage_events', 'wallets'
  ];
BEGIN
  -- A missing canonical RPC means this database has not reached the billing
  -- migration baseline. Refuse to claim that the lockdown was applied.
  FOREACH required_name IN ARRAY ARRAY[
    'grant_credits', 'debit_credits', 'get_user_balances',
    'get_available_balance', 'reserve_bits', 'settle_bits', 'release_bits'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = required_name AND p.prosecdef
    ) THEN
      RAISE EXCEPTION 'Required SECURITY DEFINER billing RPC public.% is missing', required_name;
    END IF;
  END LOOP;

  FOR target IN
    SELECT p.oid, p.proname, p.proowner,
      format('%I.%I(%s)', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(protected_names)
      AND p.prosecdef
  LOOP
    function_signature := target.signature;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_signature);

    -- Remove alternate explicit grants as well as the default PUBLIC grant.
    -- Do not touch unrelated functions or PostgreSQL's owner privilege.
    FOR grantee_name IN
      SELECT DISTINCT r.rolname
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      JOIN pg_roles r ON r.oid = acl.grantee
      WHERE p.oid = target.oid
        AND acl.grantee <> target.proowner
        AND r.rolname <> 'service_role'
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', function_signature, grantee_name);
    END LOOP;

    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_signature);
    -- Every selected body schema-qualifies relation and RPC references.
    -- Built-ins remain available through pg_catalog's implicit lookup.
    EXECUTE format('ALTER FUNCTION %s SET search_path = %L', function_signature, '');

    IF has_function_privilege('anon', target.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', target.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', target.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Billing RPC privilege check failed for %', function_signature;
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required billing table public.% is missing', table_name;
    END IF;
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT TRUNCATE ON TABLE public.%I TO service_role', table_name);
    IF has_table_privilege('anon', format('public.%I', table_name), 'TRUNCATE')
       OR has_table_privilege('authenticated', format('public.%I', table_name), 'TRUNCATE') THEN
      RAISE EXCEPTION 'Billing table TRUNCATE privilege check failed for public.%', table_name;
    END IF;
  END LOOP;

  -- This table also has a permissive PUBLIC RLS policy. Removing direct API
  -- role grants prevents clients from reading or falsifying reconciliations.
  ALTER POLICY "Service role can manage billing_reconciliations"
    ON public.billing_reconciliations TO service_role;
  REVOKE ALL ON TABLE public.billing_reconciliations FROM PUBLIC, anon, authenticated;
  GRANT ALL ON TABLE public.billing_reconciliations TO service_role;
  IF has_table_privilege('anon', 'public.billing_reconciliations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.billing_reconciliations', 'SELECT')
     OR has_table_privilege('anon', 'public.billing_reconciliations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.billing_reconciliations', 'INSERT') THEN
    RAISE EXCEPTION 'Billing reconciliation table privilege check failed';
  END IF;
END;
$billing_rpc_lockdown$;
