/**
 * Local-database proof for the Stripe webhook.
 *
 * Skipped unless RUN_STRIPE_LOCAL_DB=1. Run this file by itself so the
 * admin client captures the local URL (it reads env at module load):
 *
 *   RUN_STRIPE_LOCAL_DB=1 pnpm exec vitest run tests/stripe-webhook-local-db.test.ts
 *
 * Database and API default to the Supabase CLI local stack
 * (`supabase start`): Postgres on 127.0.0.1:54322 and PostgREST on
 * 127.0.0.1:54321. The anon and service-role JWTs are signed at runtime
 * with SUPABASE_JWT_SECRET (default is a local fixture string, not a
 * credential). Override the database and API with SUPABASE_DB_URL and
 * SUPABASE_LOCAL_API_URL.
 *
 * Signature checks use Stripe's test-header generator. subscriptions.retrieve
 * is mocked: invoice.paid re-reads the live subscription, and this file
 * must not call api.stripe.com. No billing_admin role and no stand-in
 * PostgREST are created here.
 */
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import Stripe from "stripe";

function fixtureJwt(role: "anon" | "service_role"): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const secret =
    process.env.SUPABASE_JWT_SECRET ??
    "local-webhook-fixture-secret-not-a-credential";
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "supabase-demo",
    role,
    exp: 1983812996,
  })}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

vi.mock("stripe", async () => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe");
  const RealStripe = actual.default;
  function StripeWithLocalSubscription(
    this: unknown,
    key: string,
    config?: ConstructorParameters<typeof RealStripe>[1],
  ) {
    const client = new RealStripe(key, config);
    client.subscriptions.retrieve = (async (id: string) => ({
      id,
      status: "active" as const,
      metadata: {},
      items: { data: [] },
      cancel_at_period_end: false,
      customer: null,
    })) as unknown as typeof client.subscriptions.retrieve;
    return client;
  }
  return { ...actual, default: StripeWithLocalSubscription };
});

const ENABLED = process.env.RUN_STRIPE_LOCAL_DB === "1" || process.env.BILLING_REQUIRE_DB === "1";
if (process.env.BILLING_REQUIRE_DB === "1" && process.env.RUN_STRIPE_LOCAL_DB !== "1") {
  throw new Error("BILLING_REQUIRE_DB requires RUN_STRIPE_LOCAL_DB=1 so the webhook suite cannot skip");
}
const WHSEC = "whsec_local_db_fixture";
const STRIPE_KEY = "sk_test_local_fixture_not_a_live_key";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = process.env.SUPABASE_LOCAL_API_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = fixtureJwt("anon");
const SERVICE_ROLE_KEY = fixtureJwt("service_role");

type Scenario = {
  id: number;
  name: string;
  status: "PASS" | "FAIL";
  http: number | null;
  detail: string;
  db: unknown;
};

const report: Scenario[] = [];

describe.skipIf(!ENABLED)("stripe webhook against local Postgres", () => {
  const db = new Client({ connectionString: DB_URL });
  const stripe = new Stripe(STRIPE_KEY);
  let post: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    if (!STRIPE_KEY.startsWith("sk_test_")) {
      throw new Error("refusing non-test Stripe key");
    }

    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_creator_local";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_local";

    vi.resetModules();
    const mod = await import("@/app/api/stripe/webhook/route");
    post = mod.POST as unknown as (req: Request) => Promise<Response>;
    await db.connect();
    await db.query(readFileSync(
      "supabase/migrations/20261015200000_apply_subscription_event.sql",
      "utf8",
    ));
    await db.query(`NOTIFY pgrst, 'reload schema'`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await db.query(`
      DELETE FROM public.billing_subscription_conflicts
      WHERE stripe_event_id LIKE 'evt_local658_%';
      DELETE FROM public.credit_ledger
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'local658_%');
      DELETE FROM public.subscriptions
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'local658_%');
      DELETE FROM public.users WHERE clerk_id LIKE 'local658_%';
      DELETE FROM public.stripe_events WHERE stripe_event_id LIKE 'evt_local658_%';
    `);
  }, 30_000);

  afterAll(async () => {
    await db.end().catch(() => undefined);
    writeFileSync("/tmp/stripe-webhook-scenarios.json", JSON.stringify(report, null, 2));
    console.log("\nLOCAL_DB_SCENARIOS\n" + JSON.stringify(report, null, 2));
  });

  async function userId(clerkId: string): Promise<string> {
    const found = await db.query(`SELECT id FROM public.users WHERE clerk_id = $1`, [clerkId]);
    if (found.rows[0]) return found.rows[0].id as string;
    const inserted = await db.query(
      `INSERT INTO public.users (clerk_id, email, name) VALUES ($1, $2, $1) RETURNING id`,
      [clerkId, `${clerkId}@example.test`],
    );
    return inserted.rows[0].id as string;
  }

  async function snapshot(clerkId: string, eventIds: string[]) {
    const user = await db.query(`SELECT id FROM public.users WHERE clerk_id = $1`, [clerkId]);
    const id = user.rows[0]?.id ?? null;
    const ledger = id
      ? await db.query(
          `SELECT amount, direction, category, balance_bucket, idempotency_key
           FROM public.credit_ledger WHERE user_id = $1 ORDER BY idempotency_key`,
          [id],
        )
      : { rows: [] };
    const subscription = id
      ? await db.query(
          `SELECT plan, status, stripe_subscription_id
           FROM public.subscriptions WHERE user_id = $1`,
          [id],
        )
      : { rows: [] };
    const events = await db.query(
      `SELECT stripe_event_id, event_type, result
       FROM public.stripe_events WHERE stripe_event_id = ANY($1::text[])
       ORDER BY stripe_event_id`,
      [eventIds],
    );
    return {
      ledger: ledger.rows,
      subscription: subscription.rows,
      events: events.rows,
    };
  }

  async function deliver(event: Record<string, unknown>, signature?: string | null) {
    const payload = JSON.stringify(event);
    const headers = new Headers({ "content-type": "application/json" });
    if (signature === undefined) {
      headers.set(
        "stripe-signature",
        stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }),
      );
    } else if (signature !== null) {
      headers.set("stripe-signature", signature);
    }
    const response = await post(
      new Request("http://127.0.0.1/api/stripe/webhook", {
        method: "POST",
        body: payload,
        headers,
      }),
    );
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  function subscriptionCreated(id: string, subId: string, clerkId: string, planId: string, priceId: string) {
    return {
      id,
      type: "customer.subscription.created",
      data: {
        object: {
          id: subId,
          status: "active",
          customer: `cus_${subId}`,
          metadata: { clerk_id: clerkId, plan_id: planId, product_type: "plan" },
          items: {
            data: [{
              price: { id: priceId },
              current_period_start: 1700000000,
              current_period_end: 1702678400,
            }],
          },
        },
      },
    };
  }

  function invoicePaid(id: string, invoiceId: string, subId: string) {
    return {
      id,
      type: "invoice.paid",
      data: {
        object: {
          id: invoiceId,
          customer: `cus_${subId}`,
          parent: { subscription_details: { subscription: subId } },
          lines: { data: [{ period: { end: 1702678400 }, pricing: { price_details: { price: "" } } }] },
        },
      },
    };
  }

  async function run(id: number, name: string, fn: () => Promise<{ http: number; detail: string; db: unknown }>) {
    try {
      const result = await fn();
      const status = result.detail.startsWith("FAIL") ? "FAIL" : "PASS";
      report.push({ id, name, status, http: result.http, detail: result.detail, db: result.db });
    } catch (error) {
      report.push({
        id,
        name,
        status: "FAIL",
        http: null,
        detail: error instanceof Error ? error.message : String(error),
        db: null,
      });
    }
  }

  it("exercises the eight billing scenarios and records database rows", async () => {
    const rls = await db.query(`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('users', 'subscriptions', 'credit_ledger', 'stripe_events')
      ORDER BY 1
    `);
    const unique = await db.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'subscriptions_stripe_subscription_id_uidx'
    `);
    expect(rls.rows.every((row) => row.relrowsecurity === true)).toBe(true);
    expect(unique.rows).toHaveLength(1);

    await run(1, "Creator checkout grants 7,500", async () => {
      const clerk = "local658_creator";
      await userId(clerk);
      const created = await deliver(
        subscriptionCreated("evt_local658_creator_sub", "sub_local658_creator", clerk, "creator_beta", "price_creator_local"),
      );
      const paid = await deliver(
        invoicePaid("evt_local658_creator_inv", "in_local658_creator", "sub_local658_creator"),
      );
      const dbRows = await snapshot(clerk, ["evt_local658_creator_sub", "evt_local658_creator_inv"]);
      const amount = dbRows.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
      const ok = created.status === 200 && paid.status === 200 && amount === 7500 && dbRows.ledger.length === 1
        && dbRows.subscription[0]?.plan === "creator_beta" && dbRows.subscription[0]?.status === "active"
        && dbRows.events.every((row) => row.result === "processed");
      return {
        http: paid.status,
        detail: ok ? `subscription.created ${created.status}, invoice.paid ${paid.status}, ledger ${amount}` : `FAIL created=${created.status} paid=${paid.status} amount=${amount} body=${JSON.stringify(paid.body)}`,
        db: dbRows,
      };
    });

    await run(2, "Pro checkout grants 18,000", async () => {
      const clerk = "local658_pro";
      await userId(clerk);
      const created = await deliver(
        subscriptionCreated("evt_local658_pro_sub", "sub_local658_pro", clerk, "pro_builder_beta", "price_pro_local"),
      );
      const paid = await deliver(
        invoicePaid("evt_local658_pro_inv", "in_local658_pro", "sub_local658_pro"),
      );
      const dbRows = await snapshot(clerk, ["evt_local658_pro_sub", "evt_local658_pro_inv"]);
      const amount = dbRows.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
      const ok = created.status === 200 && paid.status === 200 && amount === 18000 && dbRows.ledger.length === 1
        && dbRows.subscription[0]?.plan === "pro_builder_beta";
      return {
        http: paid.status,
        detail: ok ? `subscription.created ${created.status}, invoice.paid ${paid.status}, ledger ${amount}` : `FAIL created=${created.status} paid=${paid.status} amount=${amount} body=${JSON.stringify(paid.body)} createdBody=${JSON.stringify(created.body)}`,
        db: dbRows,
      };
    });

    await run(3, "Duplicate delivery never double-credits", async () => {
      const clerk = "local658_dup";
      await userId(clerk);
      await deliver(subscriptionCreated("evt_local658_dup_sub", "sub_local658_dup", clerk, "creator_beta", "price_creator_local"));
      const first = await deliver(invoicePaid("evt_local658_dup_inv", "in_local658_dup", "sub_local658_dup"));
      const replay = await deliver(invoicePaid("evt_local658_dup_inv", "in_local658_dup", "sub_local658_dup"));
      const otherEvent = await deliver(invoicePaid("evt_local658_dup_inv_b", "in_local658_dup", "sub_local658_dup"));
      const dbRows = await snapshot(clerk, ["evt_local658_dup_inv", "evt_local658_dup_inv_b"]);
      const amount = dbRows.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
      const replayed = (replay.body as { replayed?: boolean } | null)?.replayed === true;
      const ok = first.status === 200 && replay.status === 200 && replayed && otherEvent.status === 200
        && dbRows.ledger.length === 1 && amount === 7500;
      return {
        http: replay.status,
        detail: ok
          ? `first ${first.status}, replay ${replay.status} replayed=true, second event ${otherEvent.status}, ledger rows ${dbRows.ledger.length} amount ${amount}`
          : `FAIL first=${first.status} replay=${replay.status} replayed=${replayed} other=${otherEvent.status} amount=${amount} body=${JSON.stringify(otherEvent.body)}`,
        db: dbRows,
      };
    });

    await run(4, "Failed payment sets past_due and grants nothing", async () => {
      const clerk = "local658_pastdue";
      await userId(clerk);
      await deliver(subscriptionCreated("evt_local658_pd_sub", "sub_local658_pd", clerk, "creator_beta", "price_creator_local"));
      const failed = await deliver({
        id: "evt_local658_pd_fail",
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_local658_pd",
            parent: { subscription_details: { subscription: "sub_local658_pd" } },
          },
        },
      });
      const dbRows = await snapshot(clerk, ["evt_local658_pd_fail"]);
      const ok = failed.status === 200 && dbRows.ledger.length === 0 && dbRows.subscription[0]?.status === "past_due";
      return {
        http: failed.status,
        detail: ok ? `invoice.payment_failed ${failed.status}, ledger empty, status past_due` : `FAIL status=${failed.status} body=${JSON.stringify(failed.body)} sub=${JSON.stringify(dbRows.subscription)}`,
        db: dbRows,
      };
    });

    await run(5, "Cancellation sets canceled", async () => {
      const clerk = "local658_cancel";
      await userId(clerk);
      await deliver(subscriptionCreated("evt_local658_cancel_sub", "sub_local658_cancel", clerk, "creator_beta", "price_creator_local"));
      const deleted = await deliver({
        id: "evt_local658_cancel_del",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_local658_cancel" } },
      });
      const dbRows = await snapshot(clerk, ["evt_local658_cancel_del"]);
      const ok = deleted.status === 200 && dbRows.subscription[0]?.status === "canceled" && dbRows.ledger.length === 0;
      return {
        http: deleted.status,
        detail: ok ? `customer.subscription.deleted ${deleted.status}, status canceled, ledger empty` : `FAIL status=${deleted.status} body=${JSON.stringify(deleted.body)} sub=${JSON.stringify(dbRows.subscription)}`,
        db: dbRows,
      };
    });

    await run(6, "Invalid or missing signature returns 400; valid returns 200", async () => {
      const missing = await deliver({ id: "evt_local658_sig_missing", type: "invoice.paid", data: { object: {} } }, null);
      const invalid = await deliver({ id: "evt_local658_sig_bad", type: "invoice.paid", data: { object: {} } }, "t=1,v1=deadbeef");
      const valid = await deliver({
        id: "evt_local658_sig_ok",
        type: "checkout.session.expired",
        data: { object: { id: "cs_local658_expired", metadata: {} } },
      });
      const events = await db.query(
        `SELECT stripe_event_id, result FROM public.stripe_events WHERE stripe_event_id = ANY($1::text[])`,
        [["evt_local658_sig_missing", "evt_local658_sig_bad", "evt_local658_sig_ok"]],
      );
      const ok = missing.status === 400 && invalid.status === 400 && valid.status === 200
        && events.rows.length === 1 && events.rows[0].stripe_event_id === "evt_local658_sig_ok";
      return {
        http: valid.status,
        detail: ok
          ? `missing ${missing.status}, invalid ${invalid.status}, valid ${valid.status}`
          : `FAIL missing=${missing.status} invalid=${invalid.status} valid=${valid.status} events=${JSON.stringify(events.rows)}`,
        db: { events: events.rows },
      };
    });

    await run(7, "invoice.paid before the subscription row grants exactly once", async () => {
      const clerk = "local658_race";
      const uid = await userId(clerk);
      const before = await db.query(
        `SELECT count(*)::int AS n FROM public.subscriptions WHERE stripe_subscription_id = 'sub_local658_race'`,
      );
      const started = Date.now();
      const pending = deliver(invoicePaid("evt_local658_race_inv", "in_local658_race", "sub_local658_race"));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await db.query(
        `INSERT INTO public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status)
         VALUES ($1, 'cus_sub_local658_race', 'sub_local658_race', 'pro_builder_beta', 'incomplete')`,
        [uid],
      );
      const paid = await pending;
      const elapsed = Date.now() - started;
      const dbRows = await snapshot(clerk, ["evt_local658_race_inv"]);
      const amount = dbRows.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
      const ok = before.rows[0].n === 0 && paid.status === 200 && elapsed >= 1800
        && dbRows.ledger.length === 1 && amount === 18000
        && dbRows.events[0]?.result === "processed";
      return {
        http: paid.status,
        detail: ok
          ? `row absent at start, invoice.paid ${paid.status} after ${elapsed}ms, ledger ${amount} once`
          : `FAIL before=${before.rows[0].n} status=${paid.status} elapsed=${elapsed} amount=${amount} body=${JSON.stringify(paid.body)}`,
        db: { ...dbRows, elapsed_ms: elapsed, rows_before: before.rows[0].n },
      };
    });

    await run(8, "Failed credit grant returns 500 and is not marked processed", async () => {
      const clerk = "local658_grantfail";
      await userId(clerk);
      const pack = await deliver({
        id: "evt_local658_pack_fail",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_local658_pack_fail",
            metadata: { clerk_id: "local658_missing_user", coin_amount: "4000", product_type: "credit_pack" },
          },
        },
      });
      const packRows = await snapshot("local658_missing_user", ["evt_local658_pack_fail"]);

      await userId("local658_subfail");
      await deliver(subscriptionCreated(
        "evt_local658_subfail_sub",
        "sub_local658_subfail",
        "local658_subfail",
        "creator_beta",
        "price_creator_local",
      ));
      const original = await db.query(
        `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'grant_credits'`,
      );
      let subPaid: { status: number; body: unknown } = { status: 0, body: null };
      try {
        await db.query(`
          CREATE OR REPLACE FUNCTION public.grant_credits(
            p_user_id uuid, p_amount integer, p_category text, p_balance_bucket text,
            p_description text, p_idempotency_key text, p_reference_type text DEFAULT NULL,
            p_reference_id text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL
          ) RETURNS TABLE(granted boolean, total_after integer)
          LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
          BEGIN
            RAISE EXCEPTION 'forced grant failure for local scenario 8';
          END $$;
        `);
        subPaid = await deliver(invoicePaid("evt_local658_subfail_inv", "in_local658_subfail", "sub_local658_subfail"));
      } finally {
        await db.query(original.rows[0].def as string);
      }
      const subRows = await snapshot("local658_subfail", ["evt_local658_subfail_inv"]);
      const packOk = pack.status === 500 && packRows.events.length === 0 && packRows.ledger.length === 0;
      const subOk = subPaid.status === 500 && subRows.events.length === 0 && subRows.ledger.length === 0;
      return {
        http: subPaid.status,
        detail: packOk && subOk
          ? `credit pack ${pack.status} not processed; subscription grant ${subPaid.status} not processed`
          : `FAIL pack=${pack.status} packEvents=${packRows.events.length} sub=${subPaid.status} subEvents=${subRows.events.length} subLedger=${subRows.ledger.length} body=${JSON.stringify(subPaid.body)}`,
        db: { credit_pack: { http: pack.status, ...packRows }, subscription_grant: { http: subPaid.status, ...subRows } },
      };
    });

    await run(9, "A second active subscription does not replace the stored id", async () => {
      const clerk = "local658_conflict";
      const uid = await userId(clerk);
      await db.query(
        `INSERT INTO public.subscriptions (
           user_id, stripe_customer_id, stripe_subscription_id, plan, status, last_stripe_event_created
         ) VALUES ($1, 'cus_local658_original', 'sub_local658_original', 'creator_beta', 'active', 100)`,
        [uid],
      );
      const incoming = await deliver(
        subscriptionCreated(
          "evt_local658_conflict",
          "sub_local658_incoming",
          clerk,
          "pro_builder_beta",
          "price_pro_local",
        ),
      );
      const stored = await db.query(
        `SELECT stripe_subscription_id, plan, status FROM public.subscriptions WHERE user_id = $1`,
        [uid],
      );
      const conflicts = await db.query(
        `SELECT existing_subscription_id, incoming_subscription_id
         FROM public.billing_subscription_conflicts WHERE stripe_event_id = 'evt_local658_conflict'`,
      );
      const events = await db.query(
        `SELECT result FROM public.stripe_events WHERE stripe_event_id = 'evt_local658_conflict'`,
      );
      const ok = incoming.status === 200
        && stored.rows.length === 1
        && stored.rows[0].stripe_subscription_id === "sub_local658_original"
        && stored.rows[0].plan === "creator_beta"
        && stored.rows[0].status === "active"
        && conflicts.rows.length === 1
        && conflicts.rows[0].existing_subscription_id === "sub_local658_original"
        && conflicts.rows[0].incoming_subscription_id === "sub_local658_incoming"
        && events.rows.length === 1
        && events.rows[0].result === "superseded_subscription";
      return {
        http: incoming.status,
        detail: ok
          ? `incoming ${incoming.status}, kept sub_local658_original, conflict recorded, event superseded_subscription`
          : `FAIL status=${incoming.status} stored=${JSON.stringify(stored.rows)} conflicts=${JSON.stringify(conflicts.rows)} events=${JSON.stringify(events.rows)} body=${JSON.stringify(incoming.body)}`,
        db: { stored: stored.rows, conflicts: conflicts.rows, events: events.rows },
      };
    });

    await run(10, "A conflict that cannot be recorded returns 500 and keeps the original id", async () => {
      const clerk = "local658_conflict_fail";
      const uid = await userId(clerk);
      await db.query(
        `INSERT INTO public.subscriptions (
           user_id, stripe_customer_id, stripe_subscription_id, plan, status, last_stripe_event_created
         ) VALUES ($1, 'cus_local658_keep', 'sub_local658_keep', 'pro_builder_beta', 'active', 100)`,
        [uid],
      );
      let incoming: { status: number; body: unknown } = { status: 0, body: null };
      try {
        await db.query(
          `REVOKE INSERT ON TABLE public.billing_subscription_conflicts FROM service_role, PUBLIC`,
        );
        incoming = await deliver(
          subscriptionCreated(
            "evt_local658_conflict_fail",
            "sub_local658_other",
            clerk,
            "creator_beta",
            "price_creator_local",
          ),
        );
      } finally {
        await db.query(
          `GRANT INSERT ON TABLE public.billing_subscription_conflicts TO service_role`,
        );
      }
      const stored = await db.query(
        `SELECT stripe_subscription_id, plan FROM public.subscriptions WHERE user_id = $1`,
        [uid],
      );
      const conflicts = await db.query(
        `SELECT id FROM public.billing_subscription_conflicts WHERE stripe_event_id = 'evt_local658_conflict_fail'`,
      );
      const events = await db.query(
        `SELECT result FROM public.stripe_events WHERE stripe_event_id = 'evt_local658_conflict_fail'`,
      );
      const ok = incoming.status === 500
        && stored.rows[0]?.stripe_subscription_id === "sub_local658_keep"
        && stored.rows[0]?.plan === "pro_builder_beta"
        && conflicts.rows.length === 0
        && events.rows.length === 0;
      return {
        http: incoming.status,
        detail: ok
          ? `conflict insert denied, webhook ${incoming.status}, kept sub_local658_keep, event not processed`
          : `FAIL status=${incoming.status} stored=${JSON.stringify(stored.rows)} conflicts=${conflicts.rows.length} events=${JSON.stringify(events.rows)} body=${JSON.stringify(incoming.body)}`,
        db: { stored: stored.rows, conflicts: conflicts.rows.length, events: events.rows },
      };
    });

    await run(11, "Eight parallel new subscriptions leave one row and terminally record the rest", async () => {
      const clerk = "local658_parallel_subs";
      await userId(clerk);
      const deliveries = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          deliver({
            ...subscriptionCreated(
              `evt_local658_parallel_${index}`,
              `sub_local658_parallel_${index}`,
              clerk,
              index % 2 === 0 ? "creator_beta" : "pro_builder_beta",
              index % 2 === 0 ? "price_creator_local" : "price_pro_local",
            ),
            created: 1700000500,
          }),
        ),
      );
      const stored = await db.query(
        `SELECT stripe_subscription_id, plan, status
         FROM public.subscriptions s
         JOIN public.users u ON u.id = s.user_id
         WHERE u.clerk_id = $1`,
        [clerk],
      );
      const conflicts = await db.query(
        `SELECT incoming_subscription_id
         FROM public.billing_subscription_conflicts
         WHERE stripe_event_id LIKE 'evt_local658_parallel_%'`,
      );
      const events = await db.query(
        `SELECT result FROM public.stripe_events WHERE stripe_event_id LIKE 'evt_local658_parallel_%'`,
      );
      const processed = events.rows.filter((row) => row.result === "processed").length;
      const superseded = events.rows.filter((row) => row.result === "superseded_subscription").length;
      const ok = stored.rows.length === 1
        && stored.rows[0].status === "active"
        && deliveries.every((delivery) => delivery.status === 200)
        && processed === 1
        && superseded === 7
        && conflicts.rows.length === 7;
      return {
        http: deliveries[0]?.status ?? 0,
        detail: ok
          ? `one processed event for ${stored.rows[0].stripe_subscription_id}, seven superseded, seven conflicts`
          : `FAIL statuses=${deliveries.map((d) => d.status).join(",")} processed=${processed} superseded=${superseded} stored=${JSON.stringify(stored.rows)} conflicts=${conflicts.rows.length} bodies=${JSON.stringify(deliveries.map((d) => d.body))}`,
        db: { stored: stored.rows, conflicts: conflicts.rows.length, statuses: deliveries.map((d) => d.status) },
      };
    });

    await run(12, "A newer upgrade beats a parallel older downgrade and grants once", async () => {
      const clerk = "local658_updown";
      await userId(clerk);
      const created = await deliver({
        ...subscriptionCreated(
          "evt_local658_updown_created",
          "sub_local658_updown",
          clerk,
          "creator_beta",
          "price_creator_local",
        ),
        created: 1700000100,
      });
      const upgrade = {
        id: "evt_local658_updown_upgrade",
        type: "customer.subscription.updated",
        created: 1700000300,
        data: {
          object: {
            id: "sub_local658_updown",
            status: "active",
            customer: "cus_sub_local658_updown",
            metadata: { clerk_id: clerk, plan_id: "creator_beta" },
            items: {
              data: [{
                price: { id: "price_pro_local" },
                current_period_start: 1700000000,
                current_period_end: 1702678400,
              }],
            },
          },
        },
      };
      const downgrade = {
        id: "evt_local658_updown_downgrade",
        type: "customer.subscription.updated",
        created: 1700000200,
        data: {
          object: {
            id: "sub_local658_updown",
            status: "active",
            customer: "cus_sub_local658_updown",
            metadata: { clerk_id: clerk, plan_id: "pro_builder_beta" },
            items: {
              data: [{
                price: { id: "price_creator_local" },
                current_period_start: 1700000000,
                current_period_end: 1702678400,
              }],
            },
          },
        },
      };
      const [up, down] = await Promise.all([deliver(upgrade), deliver(downgrade)]);
      const rows = await snapshot(clerk, [
        "evt_local658_updown_created",
        "evt_local658_updown_upgrade",
        "evt_local658_updown_downgrade",
      ]);
      const amount = rows.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
      const ok = created.status === 200
        && (up.status === 200 || up.status === 500)
        && (down.status === 200 || down.status === 500)
        && rows.subscription.length === 1
        && rows.subscription[0].plan === "pro_builder_beta"
        && rows.subscription[0].stripe_subscription_id === "sub_local658_updown"
        && rows.ledger.length === 1
        && amount === 10500;
      return {
        http: up.status,
        detail: ok
          ? `plan stayed pro_builder_beta, one 10500 grant, statuses ${created.status}/${up.status}/${down.status}`
          : `FAIL created=${created.status} up=${up.status} down=${down.status} sub=${JSON.stringify(rows.subscription)} ledger=${JSON.stringify(rows.ledger)} upBody=${JSON.stringify(up.body)} downBody=${JSON.stringify(down.body)}`,
        db: rows,
      };
    });

    await run(13, "invoice.paid for a second subscription grants nothing and is terminal", async () => {
      const clerk = "local658_conflict_invoice";
      await userId(clerk);
      const created = await deliver(
        subscriptionCreated(
          "evt_local658_conflict_invoice_sub",
          "sub_local658_conflict_invoice_a",
          clerk,
          "creator_beta",
          "price_creator_local",
        ),
      );
      const paid = await deliver(
        invoicePaid(
          "evt_local658_conflict_invoice_b",
          "in_local658_conflict_invoice_b",
          "sub_local658_conflict_invoice_b",
        ),
      );
      const dbRows = await snapshot(clerk, [
        "evt_local658_conflict_invoice_sub",
        "evt_local658_conflict_invoice_b",
      ]);
      const stored = await db.query(
        `SELECT stripe_subscription_id FROM public.subscriptions s
         JOIN public.users u ON u.id = s.user_id WHERE u.clerk_id = $1`,
        [clerk],
      );
      const amount = dbRows.ledger.reduce((sum, row) => sum + Number(row.amount), 0);
      const superseded = dbRows.events.find((row) => row.stripe_event_id === "evt_local658_conflict_invoice_b");
      const ok = created.status === 200
        && paid.status === 200
        && amount === 0
        && stored.rows[0]?.stripe_subscription_id === "sub_local658_conflict_invoice_a"
        && superseded?.result === "superseded_subscription";
      return {
        http: paid.status,
        detail: ok
          ? `kept sub_local658_conflict_invoice_a, conflicting invoice ${paid.status}, ledger ${amount}`
          : `FAIL created=${created.status} paid=${paid.status} amount=${amount} stored=${JSON.stringify(stored.rows)} events=${JSON.stringify(dbRows.events)} body=${JSON.stringify(paid.body)}`,
        db: { stored: stored.rows, ledger: dbRows.ledger, events: dbRows.events },
      };
    });

    const anon = await fetch(`${API_URL}/rest/v1/credit_ledger?select=id`, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, Accept: "application/json" },
    });
    const anonBody = await anon.json();
    const service = await fetch(`${API_URL}/rest/v1/credit_ledger?select=id`, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        Accept: "application/json",
      },
    });
    const serviceBody = await service.json();
    expect(Array.isArray(anonBody) && anonBody.length === 0).toBe(true);
    expect(Array.isArray(serviceBody) && serviceBody.length > 0).toBe(true);

    const failed = report.filter((row) => row.status !== "PASS");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 120_000);
});
