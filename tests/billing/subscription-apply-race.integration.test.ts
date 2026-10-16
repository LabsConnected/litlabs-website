// @vitest-environment node
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Adversarial subscription applies against a disposable Postgres database.
 * Skips when the local server is down so CI without this cluster still runs.
 * The database name is litlabs_migration_replay. Never a prod-named database.
 */
const ADMIN_URL =
  process.env.BILLING_REPLAY_ADMIN_URL ??
  "postgresql://litlabs_test:litlabs_test@127.0.0.1:5432/postgres";
const REPLAY_DB = "litlabs_migration_replay";

if (/prod/i.test(REPLAY_DB) || /prod/i.test(ADMIN_URL)) {
  throw new Error("refusing a prod-named database");
}

async function canConnect(): Promise<boolean> {
  const client = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const current = await client.query("SELECT current_database() AS name");
    if (/prod/i.test(String(current.rows[0]?.name ?? ""))) return false;
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbUp = await canConnect();
if ((process.env.BILLING_REQUIRE_DB === "1" || process.env.RUN_BILLING_CONCURRENCY_DB === "1") && !dbUp) {
  throw new Error("BILLING_REQUIRE_DB: subscription replay database is unreachable");
}

function replayUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${REPLAY_DB}`;
  return url.toString();
}

function connect(): Client {
  return new Client({ connectionString: replayUrl() });
}

const ALLOWANCES = JSON.stringify({
  creator_beta: 7500,
  pro_builder_beta: 18000,
});

function applyCall(overrides: Record<string, unknown> = {}): { text: string; values: unknown[] } {
  const args = {
    p_user_id: overrides.p_user_id,
    p_incoming_subscription_id: overrides.p_incoming_subscription_id ?? "sub_race",
    p_stripe_event_id: overrides.p_stripe_event_id ?? "evt_race",
    p_event_type: overrides.p_event_type ?? "customer.subscription.updated",
    p_event_created: overrides.p_event_created ?? 1_700_000_200,
    p_authoritative: overrides.p_authoritative ?? true,
    p_ordering: overrides.p_ordering ?? "skip_if_older",
    p_require_existing: overrides.p_require_existing ?? false,
    p_plan: overrides.p_plan ?? "creator_beta",
    p_status: overrides.p_status ?? "active",
    p_update_plan: overrides.p_update_plan ?? true,
    p_status_policy: overrides.p_status_policy ?? "write",
    p_live_status: overrides.p_live_status ?? null,
    p_stripe_customer_id: overrides.p_stripe_customer_id ?? "cus_race",
    p_period_start: overrides.p_period_start ?? "2023-11-14T22:13:20.000Z",
    p_period_end: overrides.p_period_end ?? "2023-12-15T22:13:20.000Z",
    p_cancel_at_period_end: overrides.p_cancel_at_period_end ?? false,
    p_incoming_plan: overrides.p_incoming_plan ?? overrides.p_plan ?? "creator_beta",
    p_grant_mode: overrides.p_grant_mode ?? "none",
    p_grant_amount: overrides.p_grant_amount ?? null,
    p_grant_idempotency_key: overrides.p_grant_idempotency_key ?? null,
    p_grant_description: overrides.p_grant_description ?? null,
    p_grant_reference_id: overrides.p_grant_reference_id ?? null,
    p_grant_expires_at: overrides.p_grant_expires_at ?? null,
    p_skip_grant_idempotency_key: overrides.p_skip_grant_idempotency_key ?? null,
    p_allowances: ALLOWANCES,
  };
  const names = Object.keys(args);
  return {
    text: `SELECT public.apply_subscription_event(${names
      .map((name, index) => `${name} := $${index + 1}${name === "p_allowances" ? "::jsonb" : ""}`)
      .join(", ")}) AS result`,
    values: names.map((name) => args[name as keyof typeof args]),
  };
}

describe.skipIf(!dbUp)("atomic subscription apply", () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      const current = await admin.query("SELECT current_database() AS name");
      if (/prod/i.test(String(current.rows[0]?.name ?? ""))) {
        throw new Error("refusing a prod-named database");
      }
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [REPLAY_DB],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${REPLAY_DB}`);
      await admin.query(`CREATE DATABASE ${REPLAY_DB}`);
    } finally {
      await admin.end();
    }

    const client = connect();
    await client.connect();
    try {
      const fresh = await client.query("SELECT current_database() AS name");
      if (fresh.rows[0]?.name !== REPLAY_DB || /prod/i.test(String(fresh.rows[0]?.name))) {
        throw new Error(`replay connected to ${fresh.rows[0]?.name}`);
      }
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role NOLOGIN BYPASSRLS;
          END IF;
        END $$;
        CREATE TABLE public.users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          clerk_id text UNIQUE,
          email text,
          name text
        );
        CREATE TABLE public.generation_jobs (
          id uuid PRIMARY KEY,
          user_id uuid,
          request_id text,
          created_at timestamptz,
          status text,
          refund_status text,
          provider text,
          model text,
          modality text,
          actual_provider_cost_cents integer
        );
        CREATE TABLE public.subscriptions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
          stripe_customer_id text,
          stripe_subscription_id text,
          plan text,
          status text,
          current_period_start timestamptz,
          current_period_end timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.credit_ledger (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
          amount integer NOT NULL,
          direction text NOT NULL,
          category text NOT NULL,
          balance_bucket text NOT NULL,
          reference_type text,
          reference_id text,
          description text,
          expires_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          idempotency_key text NOT NULL UNIQUE
        );
        CREATE TABLE public.wallets (
          user_id uuid PRIMARY KEY,
          balance integer NOT NULL DEFAULT 0
        );
        CREATE TABLE public.stripe_events (
          stripe_event_id text PRIMARY KEY,
          event_type text,
          result text,
          processed_at timestamptz
        );
      `);
      await client.query(readFileSync(
        "supabase/migrations/20260726193000_unify_litbits_ledger.sql",
        "utf8",
      ));
      for (const file of [
        "supabase/migrations/20261014000000_subscriptions_stripe_subscription_id_unique.sql",
        "supabase/migrations/20261015000000_subscriptions_cancel_at_period_end.sql",
        "supabase/migrations/20261015120000_media_cap_holds.sql",
        "supabase/migrations/20261015140000_subscriptions_last_stripe_event_created.sql",
        "supabase/migrations/20261015160000_checkout_reservations.sql",
        "supabase/migrations/20261015170000_billing_subscription_conflicts.sql",
        "supabase/migrations/20261015180000_media_cap_hold_expiry.sql",
        "supabase/migrations/20261015200000_apply_subscription_event.sql",
        "supabase/migrations/20261015210000_checkout_session_lease.sql",
        "supabase/migrations/20261015220000_schedule_media_cap_sweep.sql",
      ]) {
        await client.query(readFileSync(file, "utf8"));
      }
      await client.query(readFileSync("scripts/billing-migration-precheck.sql", "utf8"));
    } finally {
      await client.end();
    }
  }, 60_000);

  async function userId(): Promise<string> {
    const client = connect();
    await client.connect();
    try {
      const inserted = await client.query(
        `INSERT INTO public.users (clerk_id, email, name)
         VALUES ('race_' || gen_random_uuid()::text, 'race@example.test', 'race')
         RETURNING id`,
      );
      return inserted.rows[0].id as string;
    } finally {
      await client.end();
    }
  }

  it("replays the billing migrations and the read-only precheck on a fresh database", async () => {
    const client = connect();
    await client.connect();
    try {
      const fn = await client.query(
        `SELECT proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'apply_subscription_event'`,
      );
      const index = await client.query(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND indexname = 'subscriptions_one_protected_per_user'`,
      );
      expect(fn.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toContain("UNIQUE INDEX");
      expect(index.rows[0].indexdef).toContain("canceled");
      expect(index.rows[0].indexdef).toContain("incomplete_expired");
    } finally {
      await client.end();
    }
  });

  it("keeps one subscription when eight different ids arrive for an empty row", async () => {
    const id = await userId();
    const clients = Array.from({ length: 8 }, () => connect());
    await Promise.all(clients.map((client) => client.connect()));
    try {
      const results = await Promise.all(
        clients.map((client, index) => {
          const call = applyCall({
            p_user_id: id,
            p_incoming_subscription_id: `sub_parallel_${index}`,
            p_stripe_event_id: `evt_parallel_${index}`,
            p_event_type: "customer.subscription.created",
            p_event_created: 1_700_000_500,
            p_authoritative: false,
            p_plan: index % 2 === 0 ? "creator_beta" : "pro_builder_beta",
            p_grant_mode: "none",
          });
          return client.query(call.text, call.values);
        }),
      );
      const outcomes = results.map((result) => result.rows[0].result.outcome).sort();
      expect(outcomes.filter((outcome) => outcome === "applied")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "conflict")).toHaveLength(7);
      const stored = await clients[0].query(
        `SELECT stripe_subscription_id, status FROM public.subscriptions WHERE user_id = $1`,
        [id],
      );
      const conflicts = await clients[0].query(
        `SELECT count(*)::int AS n FROM public.billing_subscription_conflicts WHERE user_id = $1`,
        [id],
      );
      const grants = await clients[0].query(
        `SELECT count(*)::int AS n FROM public.credit_ledger WHERE user_id = $1`,
        [id],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].status).toBe("active");
      expect(String(stored.rows[0].stripe_subscription_id)).toMatch(/^sub_parallel_/);
      expect(conflicts.rows[0].n).toBe(7);
      expect(grants.rows[0].n).toBe(0);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it("applies created, updated, and invoice.paid together as one subscription and one grant", async () => {
    const id = await userId();
    const period = "2023-12-15T22:13:20.000Z";
    const created = connect();
    const updated = connect();
    const invoice = connect();
    await Promise.all([created.connect(), updated.connect(), invoice.connect()]);
    try {
      const createdCall = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_bundle",
        p_stripe_event_id: "evt_bundle_created",
        p_event_type: "customer.subscription.created",
        p_event_created: 1_700_000_100,
        p_plan: "creator_beta",
        p_grant_mode: "none",
        p_period_end: period,
      });
      const updatedCall = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_bundle",
        p_stripe_event_id: "evt_bundle_updated",
        p_event_type: "customer.subscription.updated",
        p_event_created: 1_700_000_200,
        p_plan: "pro_builder_beta",
        p_grant_mode: "upgrade_delta",
        p_grant_idempotency_key: "plan_upgrade_sub_bundle_1702678400_pro_builder_beta",
        p_grant_reference_id: "period_plan_sub_bundle_1702678400_pro_builder_beta",
        p_period_end: period,
      });
      const invoiceCall = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_bundle",
        p_stripe_event_id: "evt_bundle_invoice",
        p_event_type: "invoice.paid",
        p_event_created: 1_700_000_300,
        p_ordering: "apply",
        p_authoritative: true,
        p_update_plan: false,
        p_status_policy: "activate_unless_terminal",
        p_live_status: "active",
        p_plan: "creator_beta",
        p_grant_mode: "invoice_full",
        p_grant_amount: 7500,
        p_grant_idempotency_key: "invoice_grant_in_bundle",
        p_grant_description: "Creator Beta monthly grant — 7500 LiTTBits",
        p_grant_reference_id: "period_plan_sub_bundle_1702678400_creator_beta",
        p_skip_grant_idempotency_key: "plan_upgrade_sub_bundle_1702678400_pro_builder_beta",
        p_period_start: null,
        p_period_end: null,
      });
      const settled = await Promise.allSettled([
        created.query(createdCall.text, createdCall.values),
        updated.query(updatedCall.text, updatedCall.values),
        invoice.query(invoiceCall.text, invoiceCall.values),
      ]);
      const storedBeforeRetry = await created.query(
        `SELECT plan FROM public.subscriptions WHERE user_id = $1`,
        [id],
      );
      const lockedPlan = storedBeforeRetry.rows[0]?.plan as string | undefined;
      const invoiceFailed = settled[2].status === "rejected";
      if (invoiceFailed && lockedPlan) {
        const allowance = lockedPlan === "pro_builder_beta" ? 18000 : 7500;
        const retry = applyCall({
          p_user_id: id,
          p_incoming_subscription_id: "sub_bundle",
          p_stripe_event_id: "evt_bundle_invoice_retry",
          p_event_type: "invoice.paid",
          p_event_created: 1_700_000_300,
          p_ordering: "apply",
          p_authoritative: true,
          p_require_existing: true,
          p_update_plan: false,
          p_status_policy: "activate_unless_terminal",
          p_live_status: "active",
          p_plan: lockedPlan,
          p_grant_mode: "invoice_full",
          p_grant_amount: allowance,
          p_grant_idempotency_key: "invoice_grant_in_bundle",
          p_grant_description: "monthly grant",
          p_grant_reference_id: `period_plan_sub_bundle_1702678400_${lockedPlan}`,
          p_skip_grant_idempotency_key: "plan_upgrade_sub_bundle_1702678400_pro_builder_beta",
          p_period_start: null,
          p_period_end: null,
        });
        await invoice.query(retry.text, retry.values);
      }
      const stored = await created.query(
        `SELECT plan, stripe_subscription_id, status FROM public.subscriptions WHERE user_id = $1`,
        [id],
      );
      const ledger = await created.query(
        `SELECT amount, idempotency_key FROM public.credit_ledger WHERE user_id = $1 ORDER BY idempotency_key`,
        [id],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].stripe_subscription_id).toBe("sub_bundle");
      expect(stored.rows[0].plan).toBe("pro_builder_beta");
      const sum = ledger.rows.reduce((total, row) => total + Number(row.amount), 0);
      expect(sum === 10500 || sum === 18000).toBe(true);
      expect(sum).toBeLessThanOrEqual(18000);
      if (sum === 18000 && ledger.rows.length === 2) {
        expect(ledger.rows.map((row) => Number(row.amount)).sort((a, b) => a - b)).toEqual([7500, 10500]);
      }
    } finally {
      await Promise.all([created.end(), updated.end(), invoice.end()]);
    }
  });

  it("does not regress the plan when an upgrade and an older downgrade run together", async () => {
    const id = await userId();
    const seed = connect();
    await seed.connect();
    const period = "2023-12-15T22:13:20.000Z";
    try {
      const seedCall = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_updown",
        p_stripe_event_id: "evt_updown_seed",
        p_event_type: "customer.subscription.created",
        p_event_created: 1_700_000_100,
        p_plan: "creator_beta",
        p_grant_mode: "none",
        p_period_end: period,
      });
      await seed.query(seedCall.text, seedCall.values);
    } finally {
      await seed.end();
    }

    const upgrade = connect();
    const downgrade = connect();
    await Promise.all([upgrade.connect(), downgrade.connect()]);
    try {
      const upgradeCall = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_updown",
        p_stripe_event_id: "evt_updown_upgrade",
        p_event_type: "customer.subscription.updated",
        p_event_created: 1_700_000_300,
        p_plan: "pro_builder_beta",
        p_grant_mode: "upgrade_delta",
        p_grant_idempotency_key: "plan_upgrade_sub_updown_1702678400_pro_builder_beta",
        p_grant_reference_id: "period_plan_sub_updown_1702678400_pro_builder_beta",
        p_period_end: period,
      });
      const downgradeCall = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_updown",
        p_stripe_event_id: "evt_updown_downgrade",
        p_event_type: "customer.subscription.updated",
        p_event_created: 1_700_000_200,
        p_plan: "creator_beta",
        p_grant_mode: "none",
        p_period_end: period,
      });
      const [up, down] = await Promise.all([
        upgrade.query(upgradeCall.text, upgradeCall.values),
        downgrade.query(downgradeCall.text, downgradeCall.values),
      ]);
      const outcomes = [up.rows[0].result.outcome, down.rows[0].result.outcome];
      expect(outcomes.every((outcome) => outcome === "applied" || outcome === "stale")).toBe(true);
      expect(outcomes).toContain("applied");
      const stored = await upgrade.query(
        `SELECT plan, stripe_subscription_id FROM public.subscriptions WHERE user_id = $1`,
        [id],
      );
      const ledger = await upgrade.query(
        `SELECT amount FROM public.credit_ledger WHERE user_id = $1`,
        [id],
      );
      expect(stored.rows[0].plan).toBe("pro_builder_beta");
      expect(stored.rows[0].stripe_subscription_id).toBe("sub_updown");
      expect(ledger.rows).toHaveLength(1);
      expect(Number(ledger.rows[0].amount)).toBe(10500);
    } finally {
      await Promise.all([upgrade.end(), downgrade.end()]);
    }
  });

  it("rolls back a failed grant and retries it once", async () => {
    const id = await userId();
    const client = connect();
    await client.connect();
    try {
      const seed = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_retry",
        p_stripe_event_id: "evt_retry_seed",
        p_event_type: "customer.subscription.created",
        p_event_created: 1_700_000_100,
        p_plan: "creator_beta",
        p_grant_mode: "none",
      });
      const seeded = await client.query(seed.text, seed.values);
      expect(seeded.rows[0].result.outcome).toBe("applied");

      const original = await client.query(
        `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'grant_credits'`,
      );
      const invoice = applyCall({
        p_user_id: id,
        p_incoming_subscription_id: "sub_retry",
        p_stripe_event_id: "evt_retry_invoice",
        p_event_type: "invoice.paid",
        p_event_created: 1_700_000_150,
        p_ordering: "apply",
        p_update_plan: false,
        p_status_policy: "activate_unless_terminal",
        p_live_status: "active",
        p_plan: "creator_beta",
        p_grant_mode: "invoice_full",
        p_grant_amount: 7500,
        p_grant_idempotency_key: "invoice_grant_in_retry",
        p_grant_description: "Creator Beta monthly grant — 7500 LiTTBits",
        p_grant_reference_id: "period_plan_sub_retry_na_creator_beta",
        p_period_start: null,
        p_period_end: null,
      });
      await client.query(`
        CREATE OR REPLACE FUNCTION public.grant_credits(
          p_user_id uuid, p_amount integer, p_category text, p_balance_bucket text,
          p_description text, p_idempotency_key text, p_reference_type text DEFAULT NULL,
          p_reference_id text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL
        ) RETURNS TABLE(granted boolean, total_after integer)
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
        BEGIN
          RAISE EXCEPTION 'forced grant failure';
        END $fn$;
      `);
      await expect(client.query(invoice.text, invoice.values)).rejects.toThrow(/forced grant failure/);
      const during = await client.query(
        `SELECT plan, status FROM public.subscriptions WHERE user_id = $1`,
        [id],
      );
      const failedLedger = await client.query(
        `SELECT count(*)::int AS n FROM public.credit_ledger WHERE user_id = $1`,
        [id],
      );
      expect(during.rows[0].plan).toBe("creator_beta");
      expect(failedLedger.rows[0].n).toBe(0);

      await client.query(original.rows[0].def as string);
      const retried = await client.query(invoice.text, invoice.values);
      expect(retried.rows[0].result.outcome).toBe("applied");
      const ledger = await client.query(
        `SELECT amount, idempotency_key FROM public.credit_ledger WHERE user_id = $1`,
        [id],
      );
      expect(ledger.rows).toHaveLength(1);
      expect(Number(ledger.rows[0].amount)).toBe(7500);
      expect(ledger.rows[0].idempotency_key).toBe("invoice_grant_in_retry");

      const again = await client.query(invoice.text, invoice.values);
      expect(again.rows[0].result.outcome).toBe("applied");
      const still = await client.query(
        `SELECT count(*)::int AS n FROM public.credit_ledger WHERE user_id = $1`,
        [id],
      );
      expect(still.rows[0].n).toBe(1);
    } finally {
      await client.end();
    }
  });
});
