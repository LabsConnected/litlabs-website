// @vitest-environment node
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const protectedNames = [
  "adjust_wallet_balance", "charge_credits", "reserve_credits", "refund_credits",
  "grant_credits", "debit_credits", "get_user_balances",
  "get_available_balance", "reserve_bits", "settle_bits", "release_bits",
  "allocate_ledger_debit",
  "expire_stale_reservations", "create_pending_agent_order",
  "fulfill_agent_purchase", "refund_agent_purchase", "expire_pending_order",
];
const protectedTables = [
  "agent_entitlements", "agent_runs", "api_key_usage", "billing_reconciliations",
  "credit_grants", "credit_ledger", "credit_reservations", "llm_usage_records",
  "marketplace_order_items", "marketplace_orders", "model_usage", "stripe_events",
  "terminal_usage", "transactions", "usage_events", "wallets",
];

async function connect() {
  const pgModule = "pg";
  const { Client } = await import(pgModule);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

describe.skipIf(!databaseUrl)("billing SECURITY DEFINER privileges (isolated database)", () => {
  it("allows only service_role and the function owner to execute protected RPCs", async () => {
    const client = await connect();
    try {
      const result = await client.query(`
        SELECT p.proname, pg_get_userbyid(p.proowner) AS owner,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
          p.prosecdef AS security_definer,
          p.proconfig AS settings
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
      `, [protectedNames]);
      expect(result.rows.map((row: { proname: string }) => row.proname).sort()).toEqual([...protectedNames].sort());
      for (const row of result.rows) {
        expect(row.security_definer, row.proname).toBe(true);
        expect(row.anon_execute, row.proname).toBe(false);
        expect(row.authenticated_execute, row.proname).toBe(false);
        expect(row.service_execute, row.proname).toBe(true);
        expect(["postgres", "supabase_admin"], row.proname).toContain(row.owner);
        expect(row.settings, row.proname).toContain('search_path=""');
      }
      const grants = await client.query(`
        SELECT p.proname, r.rolname
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl
        JOIN pg_roles r ON r.oid=acl.grantee
        WHERE n.nspname='public' AND p.proname=ANY($1::text[])
          AND acl.privilege_type='EXECUTE'
          AND acl.grantee<>p.proowner AND r.rolname<>'service_role'
      `, [protectedNames]);
      expect(grants.rows).toEqual([]);
      const alternate = await client.query(`
        SELECT pg_has_role('anon','service_role','MEMBER') AS anon_member,
          pg_has_role('authenticated','service_role','MEMBER') AS authenticated_member,
          has_schema_privilege('anon','public','CREATE') AS anon_create,
          has_schema_privilege('authenticated','public','CREATE') AS authenticated_create
      `);
      expect(alternate.rows[0]).toMatchObject({
        anon_member: false, authenticated_member: false,
        anon_create: false, authenticated_create: false,
      });
    } finally {
      await client.end();
    }
  });

  it("blocks direct billing-table truncation and reconciliation access", async () => {
    const client = await connect();
    try {
      const tables = await client.query(`
        SELECT c.relname,
          has_table_privilege('anon',c.oid,'TRUNCATE') AS anon_truncate,
          has_table_privilege('authenticated',c.oid,'TRUNCATE') AS authenticated_truncate,
          has_table_privilege('service_role',c.oid,'TRUNCATE') AS service_truncate
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind='r'
      `, [protectedTables]);
      expect(tables.rows.map((row: { relname: string }) => row.relname).sort()).toEqual([...protectedTables].sort());
      for (const row of tables.rows) {
        expect(row.anon_truncate, row.relname).toBe(false);
        expect(row.authenticated_truncate, row.relname).toBe(false);
        expect(row.service_truncate, row.relname).toBe(true);
      }
      const reconciliation = await client.query(`
        SELECT has_table_privilege('anon','public.billing_reconciliations',$1) AS anon,
          has_table_privilege('authenticated','public.billing_reconciliations',$1) AS authenticated,
          has_table_privilege('service_role','public.billing_reconciliations',$1) AS service
      `, ["SELECT"]);
      expect(reconciliation.rows[0]).toMatchObject({ anon: false, authenticated: false, service: true });
      const policy = await client.query(`
        SELECT roles FROM pg_policies WHERE schemaname='public'
          AND tablename='billing_reconciliations'
          AND policyname='Service role can manage billing_reconciliations'
      `);
      expect(policy.rows).toHaveLength(1);
      expect(policy.rows[0].roles).toBe("{service_role}");

      for (const role of ["anon", "authenticated"]) {
        await client.query("BEGIN");
        try {
          await client.query(`SET LOCAL ROLE ${role}`);
          await expect(client.query("TRUNCATE public.billing_reconciliations")).rejects.toMatchObject({ code: "42501" });
        } finally {
          await client.query("ROLLBACK");
        }
      }
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE service_role");
        const inserted = await client.query(
          "INSERT INTO public.billing_reconciliations (idempotency_key,credits_expected,reason) VALUES ($1,1,'security_test') RETURNING status",
          [`security-reconciliation-${crypto.randomUUID()}`],
        );
        expect(inserted.rows[0].status).toBe("pending");
      } finally {
        await client.query("ROLLBACK");
      }
    } finally {
      await client.end();
    }
  });

  it.each(["anon", "authenticated"])("rejects %s calls to wallet and reservation RPCs", async (role) => {
    const client = await connect();
    const functionCalls = await client.query(`
      SELECT format('SELECT * FROM public.%I(%s)', p.proname,
        coalesce((SELECT string_agg(format('NULL::%s',format_type(p.proargtypes[i],NULL)),', ' ORDER BY i)
          FROM generate_series(0,p.pronargs-1) AS args(i)),'')) AS call
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY($1::text[])
    `, [protectedNames]);
    expect(functionCalls.rows).toHaveLength(protectedNames.length);
    try {
      for (const { call } of functionCalls.rows as { call: string }[]) {
        await client.query("BEGIN");
        try {
          await client.query(`SET LOCAL ROLE ${role}`);
          await expect(client.query(call), call).rejects.toMatchObject({ code: "42501" });
        } finally {
          await client.query("ROLLBACK");
        }
      }
    } finally {
      await client.end();
    }
  });

  it("allows service_role to grant, reserve, settle, release, and debit test credits", async () => {
    const client = await connect();
    await client.query("BEGIN");
    try {
      const inserted = await client.query(
        "INSERT INTO public.users (clerk_id,email) VALUES ($1,$2) RETURNING id",
        [`security-test-${crypto.randomUUID()}`, "security-test@litt.test"],
      );
      const userId = inserted.rows[0].id as string;
      await client.query("SET LOCAL ROLE service_role");
      const grant = await client.query(
        "SELECT * FROM public.grant_credits($1::uuid,100,'subscription_grant','monthly','Security test grant',$2)",
        [userId, `security-grant-${crypto.randomUUID()}`],
      );
      expect(grant.rows[0]).toMatchObject({ granted: true, total_after: 100 });

      const hold = await client.query("SELECT * FROM public.reserve_bits($1::uuid,30,$2)", [userId, `security-reserve-${crypto.randomUUID()}`]);
      expect(hold.rows[0]).toMatchObject({ success: true, available_after: 70 });
      const settle = await client.query("SELECT * FROM public.settle_bits($1::uuid,12,$2)", [hold.rows[0].reservation_id, `security-settle-${crypto.randomUUID()}`]);
      expect(settle.rows[0]).toMatchObject({ success: true, settled_amount: 12, released_amount: 18 });

      const secondHold = await client.query("SELECT * FROM public.reserve_bits($1::uuid,20,$2)", [userId, `security-release-reserve-${crypto.randomUUID()}`]);
      const release = await client.query("SELECT * FROM public.release_bits($1::uuid,$2)", [secondHold.rows[0].reservation_id, `security-release-${crypto.randomUUID()}`]);
      expect(release.rows[0]).toMatchObject({ success: true, released_amount: 20 });

      const debit = await client.query("SELECT * FROM public.debit_credits($1::uuid,8,'usage','Security test debit',$2)", [userId, `security-debit-${crypto.randomUUID()}`]);
      expect(debit.rows[0]).toMatchObject({ success: true, remaining: 80 });
      const available = await client.query("SELECT * FROM public.get_available_balance($1::uuid)", [userId]);
      expect(available.rows[0]).toMatchObject({ ledger_total: 80, reserved_total: 0, available: 80 });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
