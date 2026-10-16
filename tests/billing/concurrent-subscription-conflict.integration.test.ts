// @vitest-environment node
/**
 * Adversarial concurrency proof for subscription identity (PR #672 stack).
 *
 * Two DIFFERENT Stripe subscriptions for the SAME first-time user are
 * delivered to the real webhook handler at the same instant, against real
 * Postgres + PostgREST. Expected, per trial:
 *   - exactly one subscriptions row, holding the first accepted id
 *   - exactly one billing_subscription_conflicts row naming the other id
 *   - credits granted for the held subscription only (no double grant)
 *
 * Run (disposable infrastructure only; see scripts/billing-disposable-db.sh):
 *   RUN_BILLING_CONCURRENCY_DB=1 SUPABASE_DB_URL=... SUPABASE_LOCAL_API_URL=... \
 *   SUPABASE_JWT_SECRET=... pnpm exec vitest run tests/billing/concurrent-subscription-conflict.integration.test.ts
 *
 * Set BILLING_REQUIRE_DB=1 (CI) to FAIL instead of skip when not enabled.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import Stripe from "stripe";

function jwt(role: "anon" | "service_role"): string {
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const secret = process.env.SUPABASE_JWT_SECRET ?? "local-webhook-fixture-secret-not-a-credential";
  const unsigned = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ iss: "supabase-demo", role, exp: 1983812996 })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

vi.mock("stripe", async () => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe");
  const RealStripe = actual.default;
  function StripeLocal(this: unknown, key: string, config?: ConstructorParameters<typeof RealStripe>[1]) {
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
  return { ...actual, default: StripeLocal };
});

const ENABLED = process.env.RUN_BILLING_CONCURRENCY_DB === "1";
const REQUIRED = process.env.BILLING_REQUIRE_DB === "1";
const TRIALS = Number(process.env.BILLING_RACE_TRIALS ?? "25");
const WHSEC = "whsec_race_fixture";
const STRIPE_KEY = "sk_test_race_fixture_not_a_live_key";
const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const API_URL = process.env.SUPABASE_LOCAL_API_URL ?? "";
const TAG = `race${Date.now()}`;

if (REQUIRED && !ENABLED) {
  describe("billing concurrency (required)", () => {
    it("must run: set RUN_BILLING_CONCURRENCY_DB=1 with a disposable database", () => {
      throw new Error("BILLING_REQUIRE_DB=1 but RUN_BILLING_CONCURRENCY_DB is not enabled");
    });
  });
}

describe.skipIf(!ENABLED)("concurrent subscription conflict (real Postgres)", () => {
  const db = new Client({ connectionString: DB_URL });
  const stripe = new Stripe(STRIPE_KEY);
  let post: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) {
      throw new Error("refusing non-loopback database URL");
    }
    if (/prod/i.test(DB_URL) || /:54322\b/.test(DB_URL)) {
      throw new Error("refusing a database URL that looks like the local Supabase/Prod stack");
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.STRIPE_PRICE_CREATOR_BETA = "price_creator_local";
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_local";
    vi.resetModules();
    post = (await import("@/app/api/stripe/webhook/route")).POST as unknown as typeof post;
    await db.connect();
  }, 30_000);

  afterAll(async () => {
    await db.end().catch(() => undefined);
  });

  async function deliver(event: Record<string, unknown>) {
    const payload = JSON.stringify(event);
    const res = await post(
      new Request("http://127.0.0.1/api/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: new Headers({
          "content-type": "application/json",
          "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }),
        }),
      }),
    );
    return res.status;
  }

  const created = (id: string, subId: string, clerk: string, plan: string, price: string) => ({
    id,
    type: "customer.subscription.created",
    data: {
      object: {
        id: subId,
        status: "active",
        customer: `cus_${subId}`,
        metadata: { clerk_id: clerk, plan_id: plan, product_type: "plan" },
        items: {
          data: [{ price: { id: price }, current_period_start: 1700000000, current_period_end: 1702678400 }],
        },
      },
    },
  });

  const paid = (id: string, invId: string, subId: string) => ({
    id,
    type: "invoice.paid",
    data: {
      object: {
        id: invId,
        customer: `cus_${subId}`,
        parent: { subscription_details: { subscription: subId } },
        lines: { data: [{ period: { end: 1702678400 }, pricing: { price_details: { price: "" } } }] },
      },
    },
  });

  async function mkUser(clerk: string): Promise<string> {
    const r = await db.query(
      `INSERT INTO public.users (clerk_id, email, name) VALUES ($1,$2,$1) RETURNING id`,
      [clerk, `${clerk}@example.test`],
    );
    return r.rows[0].id as string;
  }

  async function grants(uid: string) {
    const r = await db.query(
      `SELECT COALESCE(SUM(amount),0)::int AS total, COUNT(*)::int AS n
       FROM public.credit_ledger WHERE user_id=$1 AND amount>0`,
      [uid],
    );
    return r.rows[0] as { total: number; n: number };
  }

  it(`holds exactly one subscription, records the conflict, grants credits once (${TRIALS} trials)`, async () => {
    const failures: string[] = [];
    let heldA = 0;
    let heldB = 0;
    for (let i = 0; i < TRIALS; i++) {
      const clerk = `${TAG}_${i}`;
      const uid = await mkUser(clerk);
      const a = `sub_${TAG}_a_${i}`;
      const b = `sub_${TAG}_b_${i}`;
      const [sa, sb] = await Promise.all([
        deliver(created(`evt_${TAG}_ca_${i}`, a, clerk, "creator_beta", "price_creator_local")),
        deliver(created(`evt_${TAG}_cb_${i}`, b, clerk, "pro_builder_beta", "price_pro_local")),
      ]);
      const subs = (
        await db.query(`SELECT stripe_subscription_id, plan FROM public.subscriptions WHERE user_id=$1`, [uid])
      ).rows;
      const conflicts = (
        await db.query(
          `SELECT existing_subscription_id, incoming_subscription_id
           FROM public.billing_subscription_conflicts WHERE user_id=$1`,
          [uid],
        )
      ).rows;
      const stored = subs[0]?.stripe_subscription_id as string | undefined;
      const loser = stored === a ? b : a;
      const probs: string[] = [];
      const accepted = [sa, sb].filter((code) => code === 200).length;
      const retryable = [sa, sb].filter((code) => code >= 500 && code <= 599).length;
      if (accepted !== 1 || retryable !== 1) probs.push(`http ${sa}/${sb}`);
      if (subs.length !== 1) probs.push(`subscription rows=${subs.length}`);
      if (stored !== a && stored !== b) probs.push(`stored=${stored}`);
      if (
        conflicts.length !== 1 ||
        conflicts[0]?.incoming_subscription_id !== loser ||
        conflicts[0]?.existing_subscription_id !== stored
      ) {
        probs.push(`conflict rows=${JSON.stringify(conflicts)}`);
      }
      if (stored === a) heldA++;
      else heldB++;

      // Credits: pay both subscriptions' first invoices at the same instant.
      await Promise.all([
        deliver(paid(`evt_${TAG}_pa_${i}`, `in_${TAG}_a_${i}`, a)),
        deliver(paid(`evt_${TAG}_pb_${i}`, `in_${TAG}_b_${i}`, b)),
      ]);
      const ledger = await grants(uid);
      const allowance = subs[0]?.plan === "pro_builder_beta" ? 18000 : 7500;
      if (ledger.total > allowance || ledger.n > 1) {
        probs.push(`credits total=${ledger.total} grants=${ledger.n} (max one ${allowance})`);
      }
      if (probs.length) failures.push(`trial ${i}: ${probs.join("; ")}`);
    }
    console.log(
      "RACE_SUMMARY " +
        JSON.stringify({ trials: TRIALS, failures: failures.length, heldA, heldB, sample: failures.slice(0, 3) }),
    );
    expect(failures).toEqual([]);
  }, 600_000);

  it("same invoice.paid event delivered 6x concurrently grants credits exactly once", async () => {
    const clerk = `${TAG}_idem`;
    const uid = await mkUser(clerk);
    const s = `sub_${TAG}_idem`;
    expect(await deliver(created(`evt_${TAG}_idem_c`, s, clerk, "creator_beta", "price_creator_local"))).toBe(200);
    await Promise.all(
      Array.from({ length: 6 }, () => deliver(paid(`evt_${TAG}_idem_p`, `in_${TAG}_idem`, s))),
    );
    const ledger = await grants(uid);
    expect({ total: ledger.total, n: ledger.n }).toEqual({ total: 7500, n: 1 });
  }, 120_000);
});
