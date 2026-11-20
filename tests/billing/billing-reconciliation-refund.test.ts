// @vitest-environment node
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

async function connection() {
  const pgModule = "pg";
  const { Client } = await import(pgModule);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

type Client = Awaited<ReturnType<typeof connection>>;

async function testUser(client: Client) {
  const user = await client.query(
    "INSERT INTO public.users (clerk_id,email) VALUES ($1,$2) RETURNING id",
    [`billing-recon-${crypto.randomUUID()}`, `billing-recon-${crypto.randomUUID()}@litt.test`],
  );
  return user.rows[0].id as string;
}

async function balances(client: Client, userId: string) {
  const result = await client.query("SELECT * FROM public.get_user_balances($1::uuid)", [userId]);
  return result.rows[0] as { monthly: number; purchased: number; beta_promotional: number; total: number };
}

async function available(client: Client, userId: string) {
  const result = await client.query("SELECT * FROM public.get_available_balance($1::uuid)", [userId]);
  return result.rows[0] as { ledger_total: number; reserved_total: number; available: number };
}

describe.skipIf(!databaseUrl)("billing reconciliation and refund idempotency", () => {
  it("settlement debits the funded bucket so get_user_balances reconciles with the ledger", async () => {
    const client = await connection();
    try {
      await client.query("SET ROLE service_role");
      const userId = await testUser(client);

      // Grant 100 promotional bits.
      const grant = await client.query(
        "SELECT * FROM public.grant_credits($1::uuid,100,'beta_grant','beta_promotional','Promo grant',$2)",
        [userId, `recon-grant-${crypto.randomUUID()}`],
      );
      expect(grant.rows[0]).toMatchObject({ granted: true, total_after: 100 });

      // Reserve 20, settle actual usage of 12.
      const hold = await client.query(
        "SELECT * FROM public.reserve_bits($1::uuid,20,$2)",
        [userId, `recon-hold-${crypto.randomUUID()}`],
      );
      const reservationId = hold.rows[0].reservation_id as string;
      const settle = await client.query(
        "SELECT * FROM public.settle_bits($1::uuid,12,$2)",
        [reservationId, `recon-settle-${crypto.randomUUID()}`],
      );
      expect(settle.rows[0]).toMatchObject({ success: true, settled_amount: 12, released_amount: 8, available_after: 88 });

      // Canonical bucket balances must reflect the settlement: beta 88, total 88.
      expect(await balances(client, userId)).toEqual({ monthly: 0, purchased: 0, beta_promotional: 88, total: 88 });
      // Raw ledger view must agree — no divergence between the two balance sources.
      expect(await available(client, userId)).toMatchObject({ ledger_total: 88, reserved_total: 0, available: 88 });

      // The settlement debit must land in the bucket that funded the reservation.
      const debits = await client.query(
        "SELECT balance_bucket, amount, idempotency_key FROM public.credit_ledger WHERE reference_id=$1 AND direction='debit'",
        [reservationId],
      );
      expect(debits.rows).toEqual([
        expect.objectContaining({ balance_bucket: "beta_promotional", amount: 12 }),
      ]);
      expect(debits.rows[0].idempotency_key).toMatch(/:settle:beta$/);

      // Reservation state reconciles: settled 12 of 20 reserved.
      const reservation = await client.query(
        "SELECT status, settled_amount, reserved_amount FROM public.credit_reservations WHERE id=$1::uuid",
        [reservationId],
      );
      expect(reservation.rows[0]).toMatchObject({ status: "settled", settled_amount: 12, reserved_amount: 20 });

      // Retried settlement is idempotent and does not move balances again.
      const retry = await client.query(
        "SELECT * FROM public.settle_bits($1::uuid,12,$2)",
        [reservationId, `recon-settle-retry-${crypto.randomUUID()}`],
      );
      expect(retry.rows[0]).toMatchObject({ success: true, reason: "already_settled", settled_amount: 12 });
      expect(await balances(client, userId)).toMatchObject({ beta_promotional: 88, total: 88 });
      const debitCount = await client.query(
        "SELECT count(*)::int AS count FROM public.credit_ledger WHERE reference_id=$1 AND direction='debit'",
        [reservationId],
      );
      expect(debitCount.rows[0].count).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("allocates settlement debits across buckets in canonical spend order", async () => {
    const client = await connection();
    try {
      await client.query("SET ROLE service_role");
      const userId = await testUser(client);

      // 50 monthly + 50 beta promotional = 100 available.
      await client.query(
        "SELECT * FROM public.grant_credits($1::uuid,50,'subscription_grant','monthly','Monthly grant',$2)",
        [userId, `recon-m-${crypto.randomUUID()}`],
      );
      await client.query(
        "SELECT * FROM public.grant_credits($1::uuid,50,'beta_grant','beta_promotional','Beta grant',$2)",
        [userId, `recon-b-${crypto.randomUUID()}`],
      );

      const hold = await client.query(
        "SELECT * FROM public.reserve_bits($1::uuid,80,$2)",
        [userId, `recon-hold-${crypto.randomUUID()}`],
      );
      const reservationId = hold.rows[0].reservation_id as string;
      await client.query(
        "SELECT * FROM public.settle_bits($1::uuid,80,$2)",
        [reservationId, `recon-settle-${crypto.randomUUID()}`],
      );

      // Monthly drains first (50), then beta (30): monthly 0, beta 20, total 20.
      expect(await balances(client, userId)).toEqual({ monthly: 0, purchased: 0, beta_promotional: 20, total: 20 });
      expect(await available(client, userId)).toMatchObject({ ledger_total: 20, reserved_total: 0, available: 20 });

      const debits = await client.query(
        "SELECT balance_bucket, amount FROM public.credit_ledger WHERE reference_id=$1 AND direction='debit' ORDER BY balance_bucket",
        [reservationId],
      );
      expect(debits.rows).toEqual([
        { balance_bucket: "beta_promotional", amount: 30 },
        { balance_bucket: "monthly", amount: 50 },
      ]);
    } finally {
      await client.end();
    }
  });

  it("refund_credits credits the ledger exactly once across sequential retries", async () => {
    const client = await connection();
    try {
      await client.query("SET ROLE service_role");
      const userId = await testUser(client);
      const run = await client.query(
        "INSERT INTO public.agent_runs (user_id,agent_name,task) VALUES ($1::uuid,'test-agent','refund-seq') RETURNING id",
        [userId],
      );
      const runId = run.rows[0].id as string;

      await client.query("SELECT public.refund_credits($1::uuid, 30)", [runId]);
      await client.query("SELECT public.refund_credits($1::uuid, 30)", [runId]);
      await client.query("SELECT public.refund_credits($1::uuid, 30)", [runId]);

      const refunds = await client.query(
        "SELECT amount, category, idempotency_key FROM public.credit_ledger WHERE user_id=$1::uuid AND direction='credit' AND category='refund'",
        [userId],
      );
      expect(refunds.rows).toEqual([
        expect.objectContaining({ amount: 30, category: "refund", idempotency_key: `refund_credits:${runId}` }),
      ]);
      expect(await balances(client, userId)).toMatchObject({ monthly: 30, total: 30 });
    } finally {
      await client.end();
    }
  });

  it("refund_credits credits the ledger exactly once under concurrent connections", async () => {
    const first = await connection();
    const second = await connection();
    try {
      await first.query("SET ROLE service_role");
      await second.query("SET ROLE service_role");
      const userId = await testUser(first);
      const run = await first.query(
        "INSERT INTO public.agent_runs (user_id,agent_name,task) VALUES ($1::uuid,'test-agent','refund-race') RETURNING id",
        [userId],
      );
      const runId = run.rows[0].id as string;

      // Simultaneous retries on separate connections must produce one credit.
      await Promise.all([
        first.query("SELECT public.refund_credits($1::uuid, 30)", [runId]),
        second.query("SELECT public.refund_credits($1::uuid, 30)", [runId]),
        first.query("SELECT public.refund_credits($1::uuid, 30)", [runId]),
        second.query("SELECT public.refund_credits($1::uuid, 30)", [runId]),
      ]);

      const refunds = await first.query(
        "SELECT count(*)::int AS count, coalesce(sum(amount),0)::int AS amount FROM public.credit_ledger WHERE user_id=$1::uuid AND direction='credit' AND category='refund'",
        [userId],
      );
      expect(refunds.rows[0]).toEqual({ count: 1, amount: 30 });
      expect(await balances(first, userId)).toMatchObject({ monthly: 30, total: 30 });
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});
