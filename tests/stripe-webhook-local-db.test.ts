/**
 * Local-database proof for the Stripe webhook.
 *
 * Runs only when RUN_STRIPE_LOCAL_DB=1. It talks to a local Postgres that
 * has the repo migrations applied (RLS left on) through PostgREST, using a
 * service_role JWT the same way the webhook's admin client does. Payloads
 * are signed with Stripe's test-header generator. No live Stripe key is used.
 */
import { createHmac } from "crypto";
import http from "http";
import { writeFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import Stripe from "stripe";

const ENABLED = process.env.RUN_STRIPE_LOCAL_DB === "1";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const WHSEC = "whsec_local_db_fixture";
const STRIPE_KEY = "sk_test_local_fixture_not_a_live_key";
const DB_URL = "postgres://billing_admin:billing_admin@127.0.0.1:5432/litlabs_billing";

function jwt(role: string): string {
  const pack = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = pack({ alg: "HS256", typ: "JWT" });
  const payload = pack({
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  });
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

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
  let proxy: http.Server;
  const originalFetch = globalThis.fetch.bind(globalThis);

  beforeAll(async () => {
    if (!STRIPE_KEY.startsWith("sk_test_")) {
      throw new Error("refusing non-test Stripe key");
    }
    proxy = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const path = (req.url || "/").replace(/^\/rest\/v1/, "") || "/";
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (key === "host" || value == null) continue;
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const upstream = await originalFetch(`http://127.0.0.1:3000${path}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const out = Buffer.from(await upstream.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.writeHead(upstream.status, responseHeaders);
      res.end(out);
    });
    await new Promise<void>((resolve) => proxy.listen(54321, "127.0.0.1", () => resolve()));

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_creator_local";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_local";

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("api.stripe.com")) {
        throw new Error(`refusing Stripe network call during local DB proof: ${url}`);
      }
      return originalFetch(input, init);
    };

    const mod = await import("@/app/api/stripe/webhook/route");
    post = mod.POST as unknown as (req: Request) => Promise<Response>;
    await db.connect();
    await db.query(`
      DELETE FROM public.credit_ledger
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'local658_%');
      DELETE FROM public.subscriptions
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'local658_%');
      DELETE FROM public.users WHERE clerk_id LIKE 'local658_%';
      DELETE FROM public.stripe_events WHERE stripe_event_id LIKE 'evt_local658_%';
    `);
  }, 30_000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db.end().catch(() => undefined);
    await new Promise<void>((resolve) => proxy?.close(() => resolve()));
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

    const anon = await originalFetch("http://127.0.0.1:54321/rest/v1/credit_ledger?select=id", {
      headers: { Authorization: `Bearer ${jwt("anon")}`, apikey: jwt("anon"), Accept: "application/json" },
    });
    const anonBody = await anon.json();
    const service = await originalFetch("http://127.0.0.1:54321/rest/v1/credit_ledger?select=id", {
      headers: {
        Authorization: `Bearer ${jwt("service_role")}`,
        apikey: jwt("service_role"),
        Accept: "application/json",
      },
    });
    const serviceBody = await service.json();
    expect(Array.isArray(anonBody) && anonBody.length === 0).toBe(true);
    expect(Array.isArray(serviceBody) && serviceBody.length > 0).toBe(true);

    const failed = report.filter((row) => row.status !== "PASS");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 60_000);
});
