/**
 * Settled-invoice convergence. LOCAL / CI only (fake Stripe keys, disposable
 * Postgres + PostgREST). No hosted Stripe calls.
 *
 * The ledger balance after base invoice.paid, upgrade invoice.paid,
 * customer.subscription.updated, customer.subscription.deleted, and a
 * duplicate redelivery of each must be identical for every order. That
 * balance is the sum of the settled invoices: Creator 7500 + upgrade
 * delta 10500 = 18000. An unpaid or failed upgrade invoice leaves 7500,
 * and cancellation does not debit it.
 *
 *   RUN_STRIPE_LOCAL_DB=1 pnpm exec vitest run tests/billing/settled-invoice-convergence.integration.test.ts
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import Stripe from "stripe";

const { live } = vi.hoisted(() => ({
  live: new Map<string, { clerk: string; status: string; price: string }>(),
}));

function fixtureJwt(role: "anon" | "service_role"): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const secret = process.env.SUPABASE_JWT_SECRET ?? "local-webhook-fixture-secret-not-a-credential";
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "supabase-demo",
    role,
    exp: 1983812996,
  })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
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
      const row = live.get(id) ?? { clerk: "", status: "active", price: "price_creator_local" };
      return {
        id,
        status: row.status,
        metadata: { clerk_id: row.clerk, plan_id: "creator_beta" },
        items: {
          data: [{
            price: { id: row.price },
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

const ENABLED = process.env.RUN_STRIPE_LOCAL_DB === "1" || process.env.BILLING_REQUIRE_DB === "1";
if (process.env.BILLING_REQUIRE_DB === "1" && process.env.RUN_STRIPE_LOCAL_DB !== "1") {
  throw new Error("BILLING_REQUIRE_DB requires RUN_STRIPE_LOCAL_DB=1 so convergence cannot skip");
}

const WHSEC = "whsec_settled_invoice_fixture";
const STRIPE_KEY = "sk_test_settled_invoice_fixture_not_a_live_key";
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = process.env.SUPABASE_LOCAL_API_URL ?? "http://127.0.0.1:54321";
const CREATOR_PRICE = "price_creator_local";
const PRO_PRICE = "price_pro_local";
const BASE_CREDITS = 7500;
const UPGRADE_CREDITS = 10500;
const SETTLED_TOTAL = BASE_CREDITS + UPGRADE_CREDITS;
const SEEDED_ORDERS = 200;
const SEED = 20261019;

type StripeEvent = Record<string, unknown>;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const orders: T[][] = [];
  items.forEach((item, index) => {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    for (const order of permutations(rest)) orders.push([item, ...order]);
  });
  return orders;
}

describe.skipIf(!ENABLED)("settled invoice convergence (local Postgres, fake Stripe keys)", () => {
  const db = new Client({ connectionString: DB_URL });
  const stripe = new Stripe(STRIPE_KEY);
  let post: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    if (!STRIPE_KEY.startsWith("sk_test_")) throw new Error("refusing non-test Stripe key");
    if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) {
      throw new Error("refusing non-loopback database URL");
    }
    if (/prod/i.test(DB_URL)) throw new Error("refusing a prod-named database");
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = fixtureJwt("service_role");
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_CREATOR_BETA = CREATOR_PRICE;
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = PRO_PRICE;
    vi.resetModules();
    post = (await import("@/app/api/stripe/webhook/route")).POST as unknown as typeof post;
    await db.connect();
    await db.query(readFileSync("supabase/migrations/20261019120000_settled_invoice_grants.sql", "utf8"));
    await db.query(`
      DELETE FROM public.credit_ledger
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'conv_%');
      DELETE FROM public.subscriptions
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'conv_%');
      DELETE FROM public.billing_subscription_conflicts
      WHERE user_id IN (SELECT id FROM public.users WHERE clerk_id LIKE 'conv_%');
      DELETE FROM public.users WHERE clerk_id LIKE 'conv_%';
      DELETE FROM public.stripe_events WHERE stripe_event_id LIKE 'evt_conv_%';
    `);
    await db.query(`NOTIFY pgrst, 'reload schema'`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, 30_000);

  afterAll(async () => {
    await db.end().catch(() => undefined);
  });

  async function userId(clerkId: string): Promise<string> {
    const inserted = await db.query(
      `INSERT INTO public.users (clerk_id, email, name) VALUES ($1, $2, $1) RETURNING id`,
      [clerkId, `${clerkId}@example.test`],
    );
    return inserted.rows[0].id as string;
  }

  async function deliver(event: StripeEvent): Promise<number> {
    const payload = JSON.stringify(event);
    const response = await post(
      new Request("http://127.0.0.1/api/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: new Headers({
          "content-type": "application/json",
          "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }),
        }),
      }),
    );
    return response.status;
  }

  async function balance(uid: string): Promise<{ total: number; rows: number; debits: number }> {
    const result = await db.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total,
              COUNT(*)::int AS rows,
              COUNT(*) FILTER (WHERE amount < 0 OR direction = 'debit')::int AS debits
       FROM public.credit_ledger WHERE user_id = $1`,
      [uid],
    );
    return {
      total: Number(result.rows[0].total),
      rows: Number(result.rows[0].rows),
      debits: Number(result.rows[0].debits),
    };
  }

  function remember(subId: string, clerk: string) {
    live.set(subId, { clerk, status: "active", price: PRO_PRICE });
  }

  function eventsFor(clerk: string, subId: string): Record<string, StripeEvent> {
    const period = { end: 1702678400 };
    return {
      base: {
        id: `evt_${clerk}_base`,
        type: "invoice.paid",
        created: 1_700_000_100,
        data: {
          object: {
            id: `in_${clerk}_base`,
            billing_reason: "subscription_create",
            customer: `cus_${subId}`,
            metadata: { clerk_id: clerk },
            parent: {
              subscription_details: {
                subscription: subId,
                metadata: { clerk_id: clerk, plan_id: "creator_beta" },
              },
            },
            lines: { data: [{ price: { id: CREATOR_PRICE }, amount: 1500, period }] },
          },
        },
      },
      upgrade: {
        id: `evt_${clerk}_upgrade`,
        type: "invoice.paid",
        created: 1_700_000_150,
        data: {
          object: {
            id: `in_${clerk}_upgrade`,
            billing_reason: "subscription_update",
            customer: `cus_${subId}`,
            metadata: { clerk_id: clerk },
            parent: {
              subscription_details: {
                subscription: subId,
                metadata: { clerk_id: clerk },
              },
            },
            lines: {
              data: [
                { price: { id: CREATOR_PRICE }, amount: -400, period },
                { price: { id: PRO_PRICE }, amount: 1200, period },
              ],
            },
          },
        },
      },
      updated: {
        id: `evt_${clerk}_updated`,
        type: "customer.subscription.updated",
        created: 1_700_000_200,
        data: {
          object: {
            id: subId,
            status: "active",
            cancel_at_period_end: false,
            customer: `cus_${subId}`,
            metadata: { clerk_id: clerk, plan_id: "creator_beta" },
            items: {
              data: [{
                price: { id: PRO_PRICE },
                current_period_start: 1700000000,
                current_period_end: 1702678400,
              }],
            },
          },
        },
      },
      deleted: {
        id: `evt_${clerk}_deleted`,
        type: "customer.subscription.deleted",
        created: 1_700_000_300,
        data: {
          object: {
            id: subId,
            status: "canceled",
            customer: `cus_${subId}`,
            metadata: { clerk_id: clerk, plan_id: "pro_builder_beta" },
            items: {
              data: [{ price: { id: PRO_PRICE }, current_period_end: 1702678400 }],
            },
          },
        },
      },
    };
  }

  async function seedSubscription(uid: string, subId: string): Promise<void> {
    await db.query(
      `INSERT INTO public.subscriptions (
         user_id, stripe_customer_id, stripe_subscription_id, plan, status,
         current_period_start, current_period_end
       ) VALUES ($1, $2, $3, 'creator_beta', 'active', to_timestamp(1700000000), to_timestamp(1702678400))`,
      [uid, `cus_${subId}`, subId],
    );
  }

  async function runOrder(clerk: string, order: StripeEvent[]): Promise<{ total: number; rows: number; debits: number }> {
    const subId = `sub_${clerk}`;
    remember(subId, clerk);
    const uid = await userId(clerk);
    // The subscription row already exists. These orders vary webhook arrival,
    // not whether the customer was created. invoice.paid must not sit through
    // its missing-row retry before the grant can be decided.
    await seedSubscription(uid, subId);
    for (const event of order) await deliver(event);
    return balance(uid);
  }

  it("every order of the eight events settles to the same invoice total", async () => {
    const sample = eventsFor("conv_shape", "sub_conv_shape");
    const distinctOrders = permutations(["base", "upgrade", "updated", "deleted"]);
    const random = mulberry32(SEED);
    const seeded: string[][] = [];
    for (let index = 0; index < SEEDED_ORDERS; index += 1) {
      seeded.push(shuffle(["base", "upgrade", "updated", "deleted", "base", "upgrade", "updated", "deleted"], random));
    }
    const failures: string[] = [];
    let orders = 0;
    const seen = new Set<number>();

    for (const [index, names] of distinctOrders.entries()) {
      const clerk = `conv_perm_${index}`;
      const shaped = eventsFor(clerk, `sub_${clerk}`);
      const ledger = await runOrder(clerk, names.map((name) => shaped[name]));
      orders += 1;
      seen.add(ledger.total);
      if (ledger.total !== SETTLED_TOTAL || ledger.rows !== 2 || ledger.debits !== 0) {
        failures.push(`perm ${names.join(">")} total=${ledger.total} rows=${ledger.rows} debits=${ledger.debits}`);
      }
    }

    for (const [index, names] of seeded.entries()) {
      const clerk = `conv_seed_${index}`;
      const shaped = eventsFor(clerk, `sub_${clerk}`);
      const ledger = await runOrder(clerk, names.map((name) => shaped[name]));
      orders += 1;
      seen.add(ledger.total);
      if (ledger.total !== SETTLED_TOTAL || ledger.rows !== 2 || ledger.debits !== 0) {
        failures.push(`seed ${index} ${names.join(">")} total=${ledger.total} rows=${ledger.rows} debits=${ledger.debits}`);
      }
    }

    const concurrentClerk = "conv_concurrent";
    const concurrentSub = `sub_${concurrentClerk}`;
    remember(concurrentSub, concurrentClerk);
    const concurrentUser = await userId(concurrentClerk);
    await seedSubscription(concurrentUser, concurrentSub);
    const concurrentEvents = eventsFor(concurrentClerk, concurrentSub);
    const burst = ["base", "upgrade", "updated", "deleted", "base", "upgrade", "updated", "deleted"]
      .map((name) => concurrentEvents[name]);
    await Promise.all(burst.map((event) => deliver(event)));
    for (let pass = 0; pass < 4; pass += 1) {
      const again = await Promise.all(burst.map((event) => deliver(event)));
      if (again.every((status) => status === 200)) break;
    }
    const concurrentLedger = await balance(concurrentUser);
    orders += 1;
    seen.add(concurrentLedger.total);
    if (concurrentLedger.total !== SETTLED_TOTAL || concurrentLedger.rows !== 2 || concurrentLedger.debits !== 0) {
      failures.push(`concurrent total=${concurrentLedger.total} rows=${concurrentLedger.rows} debits=${concurrentLedger.debits}`);
    }

    const sameInvoice = eventsFor("conv_same_invoice", "sub_conv_same_invoice");
    remember("sub_conv_same_invoice", "conv_same_invoice");
    const sameUser = await userId("conv_same_invoice");
    await seedSubscription(sameUser, "sub_conv_same_invoice");
    await deliver(sameInvoice.base);
    const secondEvent = {
      ...sameInvoice.base,
      id: "evt_conv_same_invoice_base_other",
    };
    expect(await deliver(secondEvent)).toBe(200);
    const sameLedger = await balance(sameUser);
    if (sameLedger.total !== BASE_CREDITS || sameLedger.rows !== 1) {
      failures.push(`second event id for the same base invoice total=${sameLedger.total} rows=${sameLedger.rows}`);
    }

    console.log(
      `CONVERGENCE orders=${orders} distinctPermutations=${distinctOrders.length} seededOrders=${SEEDED_ORDERS} concurrent=1 identicalBalance=${seen.size === 1 ? SETTLED_TOTAL : "MISMATCH"} balances=${JSON.stringify([...seen])} sampleShape=${Object.keys(sample).join(",")}`,
    );
    expect(failures).toEqual([]);
    expect([...seen]).toEqual([SETTLED_TOTAL]);
  }, 600_000);

  it("an unpaid or failed upgrade leaves the base, and cancellation keeps it", async () => {
    const failures: string[] = [];
    const unpaidOrders = permutations(["base", "updated", "deleted"]);
    for (const [index, names] of unpaidOrders.entries()) {
      const clerk = `conv_unpaid_${index}`;
      const shaped = eventsFor(clerk, `sub_${clerk}`);
      const ledger = await runOrder(clerk, names.map((name) => shaped[name]));
      if (ledger.total !== BASE_CREDITS || ledger.rows !== 1 || ledger.debits !== 0) {
        failures.push(`unpaid ${names.join(">")} total=${ledger.total} rows=${ledger.rows} debits=${ledger.debits}`);
      }
    }

    const failedClerk = "conv_failed_upgrade";
    const failedSub = `sub_${failedClerk}`;
    remember(failedSub, failedClerk);
    const failedUser = await userId(failedClerk);
    await seedSubscription(failedUser, failedSub);
    const failed = eventsFor(failedClerk, failedSub);
    const failedInvoice = {
      id: `evt_${failedClerk}_fail`,
      type: "invoice.payment_failed",
      created: 1_700_000_160,
      data: {
        object: {
          id: `in_${failedClerk}_upgrade`,
          billing_reason: "subscription_update",
          customer: `cus_${failedSub}`,
          metadata: { clerk_id: failedClerk },
          parent: { subscription_details: { subscription: failedSub, metadata: { clerk_id: failedClerk } } },
          lines: {
            data: [
              { price: { id: CREATOR_PRICE }, amount: -400 },
              { price: { id: PRO_PRICE }, amount: 1200 },
            ],
          },
        },
      },
    };
    await deliver(failed.updated);
    await deliver(failed.base);
    const beforeCancel = await balance(failedUser);
    await deliver(failedInvoice);
    await deliver(failed.deleted);
    const afterCancel = await balance(failedUser);
    if (beforeCancel.total !== BASE_CREDITS || afterCancel.total !== BASE_CREDITS || afterCancel.debits !== 0) {
      failures.push(`failed upgrade before=${beforeCancel.total} after=${afterCancel.total} debits=${afterCancel.debits}`);
    }

    const periodClerk = "conv_period_end";
    const periodSub = `sub_${periodClerk}`;
    remember(periodSub, periodClerk);
    const periodUser = await userId(periodClerk);
    await seedSubscription(periodUser, periodSub);
    const period = eventsFor(periodClerk, periodSub);
    const cancelLater = {
      ...period.updated,
      id: `evt_${periodClerk}_cancel_later`,
      data: {
        object: {
          ...(period.updated.data as { object: Record<string, unknown> }).object,
          cancel_at_period_end: true,
          items: {
            data: [{
              price: { id: CREATOR_PRICE },
              current_period_start: 1700000000,
              current_period_end: 1702678400,
            }],
          },
        },
      },
    };
    await deliver(period.base);
    const earned = await balance(periodUser);
    expect(await deliver(cancelLater)).toBe(200);
    await deliver(period.deleted);
    const kept = await balance(periodUser);
    if (earned.total !== BASE_CREDITS || kept.total !== BASE_CREDITS || kept.debits !== 0) {
      failures.push(`period-end cancel earned=${earned.total} kept=${kept.total} debits=${kept.debits}`);
    }

    console.log(
      `UNPAID_OR_FAILED orders=${unpaidOrders.length + 2} balance=${BASE_CREDITS} cancellationKeepsBase=${kept.total === BASE_CREDITS}`,
    );
    expect(failures).toEqual([]);
  }, 180_000);
});
