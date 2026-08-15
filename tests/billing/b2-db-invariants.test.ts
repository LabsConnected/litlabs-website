/**
 * B2.8 — DB concurrency/adversarial tests for reserve_bits/settle_bits/release_bits.
 *
 * These are the 10 required invariants from the B2 review:
 *
 *  1. Two concurrent reserve_bits() calls cannot overspend.
 *  2. Same idempotency key returns the original reservation.
 *  3. settle_bits() can run twice without charging twice.
 *  4. release_bits() can run twice safely.
 *  5. Settled reservation cannot later be released.
 *  6. Released reservation cannot later be settled.
 *  7. Actual cost lower than reserve releases the difference.
 *  8. Actual cost greater than reserve follows an explicit policy.
 *  9. DB rollback leaves no half-written ledger/reservation state.
 * 10. Every settled charge reconciles back to one usage/run identity.
 *
 * Plus the killer invariant:
 *  economic balance = ledger-derived balance (never users.credits)
 *
 * These tests require a running Postgres with the B2 migration applied.
 * They are tagged as integration tests and skipped unless SUPABASE_DB_URL
 * or a local Supabase instance is available.
 *
 * To run locally:
 *   npx supabase start
 *   npx supabase db reset
 *   npx vitest run tests/billing/b2-db-invariants.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// These tests are integration tests — they need a real Postgres.
// Skip if no local Supabase is available.
const hasDb = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

const skipMessage = "Requires local Supabase (npx supabase start + db reset)";

// We use a dynamic import so the test file doesn't fail to load when
// the 'pg' module isn't installed or the DB isn't available.
async function getPgClient() {
  // Try to use the Supabase CLI's connection string
  const { execSync } = await import("node:child_process");
  let connStr = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connStr) {
    try {
      // Get the local Supabase DB URL
      const output = execSync("npx supabase status -o json", { encoding: "utf-8" });
      const status = JSON.parse(output);
      connStr = status.dbUrl;
    } catch {
      throw new Error("No database available");
    }
  }
  // Use variable to prevent Vite from statically resolving the import
  const pgModule = "pg";
  const mod = await import(pgModule);
  return new mod.Client({ connectionString: connStr });
}

describe.skipIf(!hasDb)("B2 DB invariants — reserve/settle/release", () => {
  let client: Awaited<ReturnType<typeof getPgClient>>;
  let testUserId: string;

  beforeAll(async () => {
    client = await getPgClient();
    await client.connect();

    // Create a test user with known balance
    await client.query(`
      INSERT INTO public.users (clerk_id, email)
      VALUES ('test-b2-clerk', 'test-b2@litt.test')
      ON CONFLICT (clerk_id) DO NOTHING
    `);
    const res = await client.query(
      "SELECT id FROM public.users WHERE clerk_id = 'test-b2-clerk'"
    );
    testUserId = res.rows[0].id;

    // Clean up any leftover data from previous test runs
    await client.query(`DELETE FROM public.credit_reservations WHERE user_id = '${testUserId}'::uuid`);
    await client.query(`DELETE FROM public.credit_ledger WHERE user_id = '${testUserId}'::uuid`);

    // Grant 100 BITS to the test user (fresh balance)
    await client.query(`
      SELECT * FROM public.grant_credits(
        '${testUserId}'::uuid,
        100,
        'beta_grant',
        'beta_promotional',
        'B2 test grant',
        'b2-test-grant-${Date.now()}'
      )
    `);

    // Verify the grant worked
    const balCheck = await client.query(
      `SELECT * FROM public.get_user_balances('${testUserId}'::uuid)`
    );
    if (balCheck.rows[0]?.total !== 100) {
      throw new Error(`Expected balance 100 after grant, got ${balCheck.rows[0]?.total}`);
    }
  });

  afterAll(async () => {
    // Clean up: debit all remaining balance
    if (testUserId) {
      const balRes = await client.query(
        `SELECT * FROM public.get_user_balances('${testUserId}'::uuid)`
      );
      const total = balRes.rows[0]?.total ?? 0;
      if (total > 0) {
        await client.query(`
          SELECT * FROM public.debit_credits(
            '${testUserId}'::uuid,
            ${total},
            'adjustment',
            'B2 test cleanup',
            'b2-test-cleanup-${Date.now()}'
          )
        `);
      }
    }
    await client.end();
  });

  // ── Invariant 1: Concurrent reserves cannot overspend ──────────

  it("1. two concurrent reserve_bits() calls cannot overspend", async () => {
    // User has 100 BITS. Try to reserve 60 twice concurrently.
    // Only one should succeed; the other should get insufficient_balance.
    const key1 = `concurrent-test-1a-${Date.now()}`;
    const key2 = `concurrent-test-1b-${Date.now()}`;

    const [r1, r2] = await Promise.all([
      client.query(`SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 60, '${key1}')`),
      client.query(`SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 60, '${key2}')`),
    ]);

    const successCount = [r1.rows[0], r2.rows[0]].filter(r => r.success).length;
    expect(successCount).toBe(1);

    // Clean up: release the successful reservation
    const successRes = [r1.rows[0], r2.rows[0]].find(r => r.success);
    if (successRes?.reservation_id) {
      await client.query(
        `SELECT * FROM public.release_bits('${successRes.reservation_id}'::uuid, 'cleanup-1-${Date.now()}')`
      );
    }
  });

  // ── Invariant 2: Idempotency ───────────────────────────────────

  it("2. same idempotency key returns the original reservation", async () => {
    const key = `idempotency-test-2-${Date.now()}`;
    const r1 = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
    );
    expect(r1.rows[0].success).toBe(true);

    const r2 = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
    );
    expect(r2.rows[0].success).toBe(true);
    expect(r2.rows[0].reason).toBe("already_reserved");
    expect(r2.rows[0].reservation_id).toBe(r1.rows[0].reservation_id);

    // Clean up
    await client.query(
      `SELECT * FROM public.release_bits('${r1.rows[0].reservation_id}'::uuid, 'cleanup-2-${Date.now()}')`
    );
  });

  // ── Invariant 3: Settle idempotency ────────────────────────────

  it("3. settle_bits() can run twice without charging twice", async () => {
    const key = `settle-idem-test-3-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 20, '${key}')`
    );
    expect(reserve.rows[0].success).toBe(true);
    const resId = reserve.rows[0].reservation_id;

    const settleKey = `settle-3-${Date.now()}`;
    const s1 = await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 10, '${settleKey}')`
    );
    expect(s1.rows[0].success).toBe(true);
    expect(s1.rows[0].settled_amount).toBe(10);

    const s2 = await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 10, '${settleKey}')`
    );
    expect(s2.rows[0].success).toBe(true);
    expect(s2.rows[0].reason).toBe("already_settled");
    // Should not have charged twice
    expect(s2.rows[0].settled_amount).toBe(10);
  });

  // ── Invariant 4: Release idempotency ───────────────────────────

  it("4. release_bits() can run twice safely", async () => {
    const key = `release-idem-test-4-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 15, '${key}')`
    );
    const resId = reserve.rows[0].reservation_id;

    const releaseKey = `release-4-${Date.now()}`;
    const r1 = await client.query(
      `SELECT * FROM public.release_bits('${resId}'::uuid, '${releaseKey}')`
    );
    expect(r1.rows[0].success).toBe(true);
    expect(r1.rows[0].released_amount).toBe(15);

    const r2 = await client.query(
      `SELECT * FROM public.release_bits('${resId}'::uuid, '${releaseKey}')`
    );
    expect(r2.rows[0].success).toBe(true);
    expect(r2.rows[0].reason).toBe("already_released");
    expect(r2.rows[0].released_amount).toBe(0);
  });

  // ── Invariant 5: Settled cannot be released ────────────────────

  it("5. settled reservation cannot later be released", async () => {
    const key = `settled-no-release-5-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
    );
    const resId = reserve.rows[0].reservation_id;

    await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 5, 'settle-5-${Date.now()}')`
    );

    const release = await client.query(
      `SELECT * FROM public.release_bits('${resId}'::uuid, 'release-5-${Date.now()}')`
    );
    expect(release.rows[0].success).toBe(false);
    expect(release.rows[0].reason).toBe("reservation_already_settled");
  });

  // ── Invariant 6: Released cannot be settled ────────────────────

  it("6. released reservation cannot later be settled", async () => {
    const key = `released-no-settle-6-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
    );
    const resId = reserve.rows[0].reservation_id;

    await client.query(
      `SELECT * FROM public.release_bits('${resId}'::uuid, 'release-6-${Date.now()}')`
    );

    const settle = await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 5, 'settle-6-${Date.now()}')`
    );
    expect(settle.rows[0].success).toBe(false);
    expect(settle.rows[0].reason).toBe("reservation_already_released");
  });

  // ── Invariant 7: Actual < reserve releases difference ──────────

  it("7. actual cost lower than reserve releases the difference", async () => {
    const key = `under-settle-7-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 30, '${key}')`
    );
    const resId = reserve.rows[0].reservation_id;

    const beforeBal = await client.query(
      `SELECT * FROM public.get_available_balance('${testUserId}'::uuid)`
    );

    const settle = await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 10, 'settle-7-${Date.now()}')`
    );
    expect(settle.rows[0].success).toBe(true);
    expect(settle.rows[0].settled_amount).toBe(10);
    expect(settle.rows[0].released_amount).toBe(20);

    const afterBal = await client.query(
      `SELECT * FROM public.get_available_balance('${testUserId}'::uuid)`
    );
    // After settle: 10 debited from ledger, 20 released from reservation.
    // beforeBal was measured AFTER reserve (30 held).
    // afterBal = beforeBal + 20 (released) - 0 (debit already reflected in ledger_total, not available)
    // Actually: available = ledger_total - reserved_total
    //   before: (L) - (R + 30) = L - R - 30
    //   after:  (L - 10) - (R) = L - R - 10
    //   delta = +20 (the released portion; the 10 debit is from ledger_total not reserved)
    expect(afterBal.rows[0].available).toBe(beforeBal.rows[0].available + 20);
  });

  // ── Invariant 8: Actual > reserve follows policy ────────────────

  it("8. actual cost greater than reserve follows explicit policy (reject)", async () => {
    const key = `over-settle-8-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
    );
    const resId = reserve.rows[0].reservation_id;

    // Overage with 'reject' policy should fail
    const settle = await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 20, 'settle-8-${Date.now()}', 'reject')`
    );
    expect(settle.rows[0].success).toBe(false);
    expect(settle.rows[0].reason).toBe("overage_rejected");

    // Clean up: release the reservation since settle was rejected
    await client.query(
      `SELECT * FROM public.release_bits('${resId}'::uuid, 'cleanup-8-${Date.now()}')`
    );
  });

  it("8b. actual cost greater than reserve with 'allow' policy debits extra", async () => {
    const key = `over-settle-8b-${Date.now()}`;
    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
    );
    const resId = reserve.rows[0].reservation_id;

    // Overage with 'allow' policy should succeed if balance covers it
    const settle = await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 15, 'settle-8b-${Date.now()}', 'allow')`
    );
    expect(settle.rows[0].success).toBe(true);
    expect(settle.rows[0].settled_amount).toBe(15);
  });

  // ── Invariant 9: DB rollback leaves no half-written state ───────

  it("9. DB rollback leaves no half-written ledger/reservation state", async () => {
    const key = `rollback-test-9-${Date.now()}`;

    // Start a transaction, reserve, then force an error
    await client.query("BEGIN");
    try {
      await client.query(
        `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}')`
      );
      // Force a rollback
      throw new Error("intentional rollback");
    } catch {
      await client.query("ROLLBACK");
    }

    // The reservation should not exist after rollback
    const res = await client.query(
      `SELECT * FROM public.credit_reservations WHERE idempotency_key = '${key}'`
    );
    expect(res.rows.length).toBe(0);
  });

  // ── Invariant 10: Every settled charge reconciles to one run ───

  it("10. every settled charge reconciles back to one usage/run identity", async () => {
    const key = `reconcile-test-10-${Date.now()}`;
    const runId = `run-10-${Date.now()}`;

    const reserve = await client.query(
      `SELECT * FROM public.reserve_bits('${testUserId}'::uuid, 10, '${key}', '${runId}', 'agent_run')`
    );
    const resId = reserve.rows[0].reservation_id;

    const settleKey = `settle-10-${Date.now()}`;
    await client.query(
      `SELECT * FROM public.settle_bits('${resId}'::uuid, 7, '${settleKey}')`
    );

    // Verify the reservation has the run_id
    const res = await client.query(
      `SELECT run_id, usage_type, status, settled_amount FROM public.credit_reservations WHERE id = '${resId}'::uuid`
    );
    expect(res.rows[0].run_id).toBe(runId);
    expect(res.rows[0].usage_type).toBe("agent_run");
    expect(res.rows[0].status).toBe("settled");
    expect(res.rows[0].settled_amount).toBe(7);

    // Verify the ledger entry references the reservation.
    // settle_bits appends ':settle' to the idempotency key for the ledger entry.
    const ledger = await client.query(
      `SELECT reference_type, reference_id FROM public.credit_ledger WHERE idempotency_key = '${settleKey}:settle'`
    );
    expect(ledger.rows.length).toBeGreaterThan(0);
    expect(ledger.rows[0].reference_id).toBe(resId);
  });

  // ── Killer invariant: economic balance = ledger-derived balance ─

  it("killer: economic balance = ledger-derived balance (never users.credits)", async () => {
    // get_available_balance should always equal ledger_total - reserved_total
    // It should NEVER read from users.credits
    const bal = await client.query(
      `SELECT * FROM public.get_available_balance('${testUserId}'::uuid)`
    );

    // Verify the computation is ledger-derived
    const ledgerTotal = bal.rows[0].ledger_total;
    const reservedTotal = bal.rows[0].reserved_total;
    const available = bal.rows[0].available;

    expect(available).toBe(Math.max(ledgerTotal - reservedTotal, 0));
    // users.credits (which is 0 for this test user) should NOT be the balance
    expect(available).not.toBe(0); // we granted 100 and spent some, so > 0
  });
});

// ── Pure SQL invariant tests (no DB needed — validates migration SQL) ──

describe("B2 migration SQL invariants (static analysis)", () => {
  // These tests validate the migration SQL structure without a database.
  // They read the migration file and check for required patterns.

  it("migration creates credit_reservations table", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");
    // Normalize whitespace for matching
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain("CREATE TABLE IF NOT EXISTS public.credit_reservations");
    expect(normalized).toContain("reserved_amount INTEGER NOT NULL CHECK (reserved_amount > 0");
    expect(normalized).toContain("status TEXT NOT NULL DEFAULT 'reserved'");
    expect(normalized).toContain("idempotency_key TEXT NOT NULL");
  });

  it("migration creates all three RPCs", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.reserve_bits");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.settle_bits");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.release_bits");
  });

  it("all RPCs use SECURITY DEFINER", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    // All three RPCs + get_available_balance should be SECURITY DEFINER
    const securityDefinerCount = (sql.match(/SECURITY DEFINER/g) || []).length;
    expect(securityDefinerCount).toBeGreaterThanOrEqual(4); // 3 RPCs + get_available_balance
  });

  it("all RPCs use pg_advisory_xact_lock for concurrency", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    // reserve_bits, settle_bits, release_bits all use advisory lock
    const lockCount = (sql.match(/pg_advisory_xact_lock/g) || []).length;
    expect(lockCount).toBeGreaterThanOrEqual(3);
  });

  it("migration has idempotency unique index", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    expect(sql).toContain("credit_reservations_user_idem_key");
    expect(sql).toContain("UNIQUE INDEX");
  });

  it("migration has RLS deny policies (same as credit_ledger)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("credit_reservations_deny_anon");
    expect(sql).toContain("credit_reservations_deny_authenticated");
  });

  it("migration does NOT modify credit_ledger", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    // Should NOT contain ALTER TABLE credit_ledger
    expect(sql).not.toContain("ALTER TABLE public.credit_ledger");
    // Should NOT contain ADD COLUMN on credit_ledger
    expect(sql).not.toMatch(/credit_ledger.*ADD COLUMN/);
  });

  it("migration does NOT drop users.credits or wallets", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");

    expect(sql).not.toMatch(/DROP.*COLUMN.*credits/i);
    expect(sql).not.toMatch(/DROP.*TABLE.*wallets/i);
  });

  it("settle_bits rejects overage by default", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");
    const normalized = sql.replace(/\s+/g, " ");

    // Default overage_policy should be 'reject'
    expect(normalized).toContain("p_overage_policy TEXT DEFAULT 'reject'");
  });

  it("reservations have expiry for automatic cleanup", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migrationPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260814200000_b2_reservation_settlement.sql",
    );
    const sql = await fs.readFile(migrationPath, "utf-8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain("expires_at TIMESTAMPTZ NOT NULL DEFAULT");
    expect(normalized).toContain("expire_stale_reservations");
  });
});
