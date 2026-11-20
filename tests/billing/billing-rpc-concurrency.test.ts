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

async function testWallet(client: Awaited<ReturnType<typeof connection>>) {
  const user = await client.query(
    "INSERT INTO public.users (clerk_id,email) VALUES ($1,$2) RETURNING id",
    [`billing-race-${crypto.randomUUID()}`, `billing-race-${crypto.randomUUID()}@litt.test`],
  );
  const userId = user.rows[0].id as string;
  const grant = await client.query(
    "SELECT * FROM public.grant_credits($1::uuid,100,'subscription_grant','monthly','Concurrency test',$2)",
    [userId, `billing-race-grant-${crypto.randomUUID()}`],
  );
  expect(grant.rows[0]).toMatchObject({ granted: true, total_after: 100 });
  return userId;
}

async function balance(client: Awaited<ReturnType<typeof connection>>, userId: string) {
  const result = await client.query("SELECT * FROM public.get_available_balance($1::uuid)", [userId]);
  return result.rows[0] as { ledger_total: number; reserved_total: number; available: number };
}

describe.skipIf(!databaseUrl)("billing RPC races (separate database connections)", () => {
  it("serializes competing reservations without overspending", async () => {
    const first = await connection();
    const second = await connection();
    try {
      const userId = await testWallet(first);
      await Promise.all([first.query("SET ROLE service_role"), second.query("SET ROLE service_role")]);
      const [a, b] = await Promise.all([
        first.query("SELECT * FROM public.reserve_bits($1::uuid,60,$2)", [userId, `race-a-${crypto.randomUUID()}`]),
        second.query("SELECT * FROM public.reserve_bits($1::uuid,60,$2)", [userId, `race-b-${crypto.randomUUID()}`]),
      ]);
      const rows = [a.rows[0], b.rows[0]];
      expect(rows.filter((row) => row.success)).toHaveLength(1);
      expect(rows.filter((row) => !row.success).map((row) => row.reason)).toEqual(["insufficient_balance"]);
      expect(await balance(first, userId)).toMatchObject({ ledger_total: 100, reserved_total: 60, available: 40 });
      const reservations = await first.query("SELECT count(*)::int AS count FROM public.credit_reservations WHERE user_id=$1::uuid", [userId]);
      expect(reservations.rows[0].count).toBe(1);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("returns one reservation for concurrent duplicate keys", async () => {
    const first = await connection();
    const second = await connection();
    try {
      const userId = await testWallet(first);
      await Promise.all([first.query("SET ROLE service_role"), second.query("SET ROLE service_role")]);
      const key = `race-duplicate-${crypto.randomUUID()}`;
      const [a, b] = await Promise.all([
        first.query("SELECT * FROM public.reserve_bits($1::uuid,30,$2)", [userId, key]),
        second.query("SELECT * FROM public.reserve_bits($1::uuid,30,$2)", [userId, key]),
      ]);
      expect(a.rows[0].success).toBe(true);
      expect(b.rows[0].success).toBe(true);
      expect(a.rows[0].reservation_id).toBe(b.rows[0].reservation_id);
      expect([a.rows[0].reason, b.rows[0].reason].sort()).toEqual(["already_reserved", "reserved"]);
      expect(await balance(first, userId)).toMatchObject({ ledger_total: 100, reserved_total: 30, available: 70 });
      const reservations = await first.query("SELECT count(*)::int AS count FROM public.credit_reservations WHERE user_id=$1::uuid", [userId]);
      expect(reservations.rows[0].count).toBe(1);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("settles concurrent retries once with one ledger debit", async () => {
    const first = await connection();
    const second = await connection();
    try {
      const userId = await testWallet(first);
      await Promise.all([first.query("SET ROLE service_role"), second.query("SET ROLE service_role")]);
      const hold = await first.query("SELECT * FROM public.reserve_bits($1::uuid,30,$2)", [userId, `race-hold-${crypto.randomUUID()}`]);
      const reservationId = hold.rows[0].reservation_id as string;
      const key = `race-settle-${crypto.randomUUID()}`;
      const [a, b] = await Promise.all([
        first.query("SELECT * FROM public.settle_bits($1::uuid,12,$2)", [reservationId, key]),
        second.query("SELECT * FROM public.settle_bits($1::uuid,12,$2)", [reservationId, key]),
      ]);
      expect([a.rows[0].reason, b.rows[0].reason].sort()).toEqual(["already_settled", "settled"]);
      expect([a.rows[0].settled_amount, b.rows[0].settled_amount]).toEqual([12, 12]);
      expect(await balance(first, userId)).toMatchObject({ ledger_total: 88, reserved_total: 0, available: 88 });
      const ledger = await first.query(
        "SELECT count(*)::int AS count, coalesce(sum(amount),0)::int AS amount FROM public.credit_ledger WHERE reference_id=$1 AND direction='debit'",
        [reservationId],
      );
      expect(ledger.rows[0]).toMatchObject({ count: 1, amount: 12 });
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("releases concurrent retries once without any refund or debit ledger entry", async () => {
    const first = await connection();
    const second = await connection();
    try {
      const userId = await testWallet(first);
      await Promise.all([first.query("SET ROLE service_role"), second.query("SET ROLE service_role")]);
      const hold = await first.query("SELECT * FROM public.reserve_bits($1::uuid,30,$2)", [userId, `race-hold-${crypto.randomUUID()}`]);
      const reservationId = hold.rows[0].reservation_id as string;
      const key = `race-release-${crypto.randomUUID()}`;
      const [a, b] = await Promise.all([
        first.query("SELECT * FROM public.release_bits($1::uuid,$2)", [reservationId, key]),
        second.query("SELECT * FROM public.release_bits($1::uuid,$2)", [reservationId, key]),
      ]);
      expect([a.rows[0].reason, b.rows[0].reason].sort()).toEqual(["already_released", "released"]);
      expect([a.rows[0].released_amount, b.rows[0].released_amount].sort((x, y) => x - y)).toEqual([0, 30]);
      expect(await balance(first, userId)).toMatchObject({ ledger_total: 100, reserved_total: 0, available: 100 });
      const ledger = await first.query("SELECT count(*)::int AS count FROM public.credit_ledger WHERE reference_id=$1", [reservationId]);
      expect(ledger.rows[0].count).toBe(0);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  });
});
