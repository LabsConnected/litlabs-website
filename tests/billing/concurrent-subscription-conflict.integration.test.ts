// @vitest-environment node
/**
 * Parallel customer.subscription.created deliveries for two different
 * subscriptions on a first-time user.
 *
 * The original proof expected both deliveries to return 200. That was the
 * silent-replace bug. The fail-closed contract is exactly one 200 for the
 * first accepted subscription id, and a retryable 5xx for the loser. The
 * loser's invoice.paid grants 0 and stays retryable so the orphan Stripe
 * subscription can be refunded or canceled from billing_subscription_conflicts.
 *
 * Default is 25 trials (BILLING_RACE_TRIALS). Skipped unless
 * RUN_BILLING_CONCURRENCY_DB=1 or BILLING_REQUIRE_DB=1. When either is set
 * and Postgres or the loopback PostgREST proxy is down, the file throws
 * instead of skipping. Refuses a non-loopback or prod-named database.
 *
 * The attached Claude patch was only scripts/rest-proxy.mjs. This file is
 * the same contract, with the 200/200 check replaced by the fail-closed one.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import Stripe from "stripe";

type KnownSub = { clerkId: string; planId: string; priceId: string };

function knownSubs(): Map<string, KnownSub> {
  const holder = globalThis as { __billingConflictClerks?: Map<string, KnownSub> };
  holder.__billingConflictClerks ??= new Map();
  return holder.__billingConflictClerks;
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
    client.subscriptions.retrieve = (async (id: string) => {
      const holder = globalThis as { __billingConflictClerks?: Map<string, KnownSub> };
      const known = holder.__billingConflictClerks?.get(id);
      return {
        id,
        status: "active" as const,
        metadata: {
          clerk_id: known?.clerkId ?? "",
          plan_id: known?.planId ?? "creator_beta",
          product_type: "plan",
        },
        items: {
          data: [{
            price: { id: known?.priceId ?? "price_creator_local" },
            current_period_start: 1700000000,
            current_period_end: 1702678400,
          }],
        },
        cancel_at_period_end: false,
        customer: `cus_${id}`,
      };
    }) as unknown as typeof client.subscriptions.retrieve;
    return client;
  }
  return { ...actual, default: StripeWithLocalSubscription };
});

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

const REQUIRED =
  process.env.BILLING_REQUIRE_DB === "1" || process.env.RUN_BILLING_CONCURRENCY_DB === "1";
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://litlabs_test:litlabs_test@127.0.0.1:5432/litlabs_billing_race";
const API_URL = process.env.SUPABASE_LOCAL_API_URL ?? "http://127.0.0.1:55321";
const TRIALS = Math.max(1, Number(process.env.BILLING_RACE_TRIALS ?? "25") || 25);
const WHSEC = "whsec_local_db_fixture";
const STRIPE_KEY = "sk_test_local_fixture_not_a_live_key";

function assertSafeTarget(raw: string): void {
  if (/prod/i.test(raw)) throw new Error("refusing a prod-named database");
  const host = new URL(raw.replace(/^postgres(ql)?:/, "http:")).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`refusing non-loopback database host ${host}`);
  }
}

async function stackReady(): Promise<boolean> {
  assertSafeTarget(DB_URL);
  assertSafeTarget(API_URL);
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const current = await client.query("SELECT current_database() AS name");
    if (/prod/i.test(String(current.rows[0]?.name ?? ""))) return false;
    const response = await fetch(`${API_URL}/rest/v1/`, { signal: AbortSignal.timeout(2000) });
    return response.status !== 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const ready = REQUIRED ? await stackReady() : false;
if (REQUIRED && !ready) {
  throw new Error("BILLING_REQUIRE_DB: disposable billing database or PostgREST proxy is unreachable");
}

describe.skipIf(!REQUIRED)("concurrent subscription conflict", () => {
  const db = new Client({ connectionString: DB_URL });
  const stripe = new Stripe(STRIPE_KEY, { timeout: 20_000, maxNetworkRetries: 2 });
  let post: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    assertSafeTarget(DB_URL);
    assertSafeTarget(API_URL);
    if (!STRIPE_KEY.startsWith("sk_test_")) throw new Error("refusing non-test Stripe key");
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = fixtureJwt("service_role");
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_creator_local";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_local";
    vi.resetModules();
    const mod = await import("@/app/api/stripe/webhook/route");
    post = mod.POST as unknown as (req: Request) => Promise<Response>;
    await db.connect();
    const current = await db.query("SELECT current_database() AS name");
    if (/prod/i.test(String(current.rows[0]?.name ?? ""))) {
      throw new Error("refusing a prod-named database");
    }
    const fn = await db.query(
      `SELECT proname FROM pg_proc WHERE proname = 'apply_subscription_event'`,
    );
    if (fn.rows.length !== 1) {
      throw new Error("apply_subscription_event is missing; run scripts/billing-disposable-db.sh");
    }
    await db.query(`NOTIFY pgrst, 'reload schema'`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, 30_000);

  afterAll(async () => {
    await db.end().catch(() => undefined);
  });

  async function deliver(event: Record<string, unknown>) {
    const payload = JSON.stringify(event);
    const response = await post(
      new Request("http://127.0.0.1/api/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }),
        },
      }),
    );
    return { status: response.status };
  }

  function created(id: string, subId: string, clerkId: string, planId: string, priceId: string) {
    return {
      id,
      type: "customer.subscription.created",
      created: 1_700_000_500,
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
      created: 1_700_000_600,
      data: {
        object: {
          id: invoiceId,
          customer: `cus_${subId}`,
          parent: { subscription_details: { subscription: subId } },
          lines: {
            data: [{
              period: { end: 1702678400 },
              pricing: { price_details: { price: "" } },
            }],
          },
        },
      },
    };
  }

  it("keeps the first subscription and 5xxs the conflicting one", async () => {
    const failures: string[] = [];
    let passed = 0;
    try {
      for (let trial = 0; trial < TRIALS; trial += 1) {
        const clerk = `race658_${trial}_${crypto.randomUUID()}`;
        const subA = `sub_race658_${trial}_a`;
        const subB = `sub_race658_${trial}_b`;
        const inserted = await db.query(
          `INSERT INTO public.users (clerk_id, email, name) VALUES ($1, $2, $1) RETURNING id`,
          [clerk, `${clerk}@example.test`],
        );
        const userId = inserted.rows[0].id as string;
        knownSubs().set(subA, { clerkId: clerk, planId: "creator_beta", priceId: "price_creator_local" });
        knownSubs().set(subB, { clerkId: clerk, planId: "pro_builder_beta", priceId: "price_pro_local" });
        const eventA = `evt_race658_${trial}_a`;
        const eventB = `evt_race658_${trial}_b`;
        const [first, second] = await Promise.all([
          deliver(created(eventA, subA, clerk, "creator_beta", "price_creator_local")),
          deliver(created(eventB, subB, clerk, "pro_builder_beta", "price_pro_local")),
        ]);
        const statuses = [first.status, second.status];
        const winners = statuses.filter((status) => status === 200).length;
        const losers = statuses.filter((status) => status >= 500 && status < 600).length;
        const stored = await db.query(
          `SELECT stripe_subscription_id, plan, status FROM public.subscriptions WHERE user_id = $1`,
          [userId],
        );
        const winningSub = first.status === 200 ? subA : subB;
        const losingSub = winningSub === subA ? subB : subA;
        const losingEvent = winningSub === subA ? eventB : eventA;
        const conflicts = await db.query(
          `SELECT existing_subscription_id, incoming_subscription_id
           FROM public.billing_subscription_conflicts
           WHERE stripe_event_id = $1`,
          [losingEvent],
        );
        const kept = stored.rows[0]?.stripe_subscription_id === winningSub
          && stored.rows.length === 1
          && stored.rows[0]?.status === "active"
          && conflicts.rows.length === 1
          && conflicts.rows[0].existing_subscription_id === winningSub
          && conflicts.rows[0].incoming_subscription_id === losingSub;
        const invoice = await deliver(invoicePaid(`evt_race658_${trial}_inv`, `in_race658_${trial}`, losingSub));
        const ledger = await db.query(
          `SELECT COALESCE(SUM(amount), 0)::int AS amount FROM public.credit_ledger WHERE user_id = $1`,
          [userId],
        );
        const invoiceConflict = await db.query(
          `SELECT incoming_subscription_id FROM public.billing_subscription_conflicts WHERE stripe_event_id = $1`,
          [`evt_race658_${trial}_inv`],
        );
        const invoiceOk = invoice.status >= 500
          && invoice.status < 600
          && Number(ledger.rows[0]?.amount ?? 0) === 0
          && invoiceConflict.rows[0]?.incoming_subscription_id === losingSub;
        const stillKept = await db.query(
          `SELECT stripe_subscription_id FROM public.subscriptions WHERE user_id = $1`,
          [userId],
        );
        if (winners !== 1 || losers !== 1 || !kept || !invoiceOk || stillKept.rows[0]?.stripe_subscription_id !== winningSub) {
          failures.push(
            `trial ${trial}: statuses=${statuses.join(",")} stored=${stored.rows[0]?.stripe_subscription_id} conflicts=${JSON.stringify(conflicts.rows)} invoice=${invoice.status} ledger=${ledger.rows[0]?.amount} invoiceConflict=${JSON.stringify(invoiceConflict.rows)}`,
          );
          break;
        }
        passed += 1;
      }
    } finally {
      console.log(`RACE_SUMMARY ${JSON.stringify({ trials: TRIALS, passed, failed: failures.length })}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
    expect(passed).toBe(TRIALS);
  }, 600_000);
});
