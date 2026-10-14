// Uses the REAL stripe SDK signature verification (no constructEvent mock).
// subscriptions.retrieve is stubbed so a fake sk_test_ key never hits the network.
import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

const retrieveMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => {
  throw new Error("Stripe network disabled in unit tests");
});

vi.mock("stripe", async () => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe");
  const RealStripe = actual.default;
  class StripeNoNetwork extends RealStripe {
    constructor(...args: ConstructorParameters<typeof RealStripe>) {
      super(...args);
      this.subscriptions.retrieve = retrieveMock as typeof this.subscriptions.retrieve;
    }
  }
  return { default: StripeNoNetwork };
});

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: vi.fn(), isAdminSupabaseConfigured: vi.fn() }));
vi.mock("@/lib/business-operations", () => ({ confirmBookingPayment: vi.fn(), recordAudit: vi.fn() }));
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { POST } from "@/app/api/stripe/webhook/route";

const SECRET = "whsec_test_local_fixture";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_real";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
const stripe = new Stripe("sk_test_dummy_not_real");

function req(payload: string, sig?: string) {
  const h = new Headers();
  if (sig !== undefined) h.set("stripe-signature", sig);
  return new Request("http://x/api/stripe/webhook", { method: "POST", body: payload, headers: h }) as any;
}
function signed(evt: object) {
  const payload = JSON.stringify(evt);
  return req(payload, stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }));
}

type EventRow = { result: string; processed_at: string };

function fakeDb(opts: { subRowAfter?: number; grantError?: boolean; plan?: string } = {}) {
  const db = {
    events: new Map<string, EventRow>(),
    ledger: new Map<string, number>(),
    subLookups: 0,
    upserts: [] as { table: string; row: any; onConflict?: string }[],
  };
  const sb: any = {
    _plan: opts.plan,
    from(t: string) {
      const q: any = { _t: t, _f: {} as Record<string, unknown>, _op: "", _patch: null as any, _row: null as any };
      const exec = async () => {
        if (q._op === "insert" && t === "stripe_events") {
          const row = q._row;
          if (db.events.has(row.stripe_event_id)) {
            return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          db.events.set(row.stripe_event_id, {
            result: row.result,
            processed_at: new Date().toISOString(),
          });
          return { error: null };
        }
        if (q._op === "delete" && t === "stripe_events") {
          const row = db.events.get(q._f.stripe_event_id);
          if (row && (!q._f.result || row.result === q._f.result)) db.events.delete(q._f.stripe_event_id);
          return { error: null };
        }
        if (q._op === "update" && t === "stripe_events") {
          const row = db.events.get(q._f.stripe_event_id);
          if (row && (!q._f.result || row.result === q._f.result)) Object.assign(row, q._patch);
          return { error: null };
        }
        return { error: null };
      };
      q.select = () => q;
      q.eq = (k: string, v: any) => { q._f[k] = v; return q; };
      q.update = (patch: any) => { q._op = "update"; q._patch = patch; return q; };
      q.delete = () => { q._op = "delete"; return q; };
      q.upsert = async (row: any, options?: { onConflict?: string }) => {
        db.upserts.push({ table: t, row, onConflict: options?.onConflict });
        return { error: null };
      };
      q.insert = async (row: any) => { q._op = "insert"; q._row = row; return exec(); };
      q.single = async () => {
        if (t === "stripe_events") {
          const row = db.events.get(q._f.stripe_event_id);
          return { data: row ? { id: 1, result: row.result, processed_at: row.processed_at } : null, error: null };
        }
        if (t === "users") return { data: { id: "u1" }, error: null };
        if (t === "subscriptions" && q._f.stripe_subscription_id) {
          db.subLookups++;
          const ok = opts.subRowAfter !== undefined && db.subLookups >= opts.subRowAfter;
          return { data: ok ? { user_id: "u1", plan: sb._plan ?? "creator_beta" } : null, error: null };
        }
        return { data: null, error: null };
      };
      q.then = (resolve: any, reject: any) => exec().then(resolve, reject);
      return q;
    },
    async rpc(_n: string, a: any) {
      if (opts.grantError) return { error: { message: "boom" } };
      if (!db.ledger.has(a.p_idempotency_key)) db.ledger.set(a.p_idempotency_key, a.p_amount);
      return { error: null };
    },
  };
  vi.mocked(isAdminSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getAdminSupabase).mockReturnValue(sb);
  return { db, sb };
}
const invoicePaid = (id = "evt_1", inv = "in_1") => ({
  id,
  type: "invoice.paid",
  data: {
    object: {
      id: inv,
      customer: "cus_1",
      parent: { subscription_details: { subscription: "sub_1" } },
      lines: { data: [{ period: { end: 1900000000 } }] },
    },
  },
});
const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

beforeEach(() => {
  vi.useRealTimers();
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_real";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  retrieveMock.mockReset();
  retrieveMock.mockRejectedValue(new Error("Stripe network disabled in unit tests"));
  vi.mocked(isAdminSupabaseConfigured).mockReset();
  vi.mocked(getAdminSupabase).mockReset();
});

describe("signature", () => {
  it("missing signature -> 400", async () => { fakeDb(); expect((await POST(req("{}"))).status).toBe(400); });
  it("invalid signature -> 400", async () => { fakeDb(); expect((await POST(req("{}", "t=1,v1=deadbeef"))).status).toBe(400); });
  it("tampered body -> 400", async () => {
    fakeDb();
    const p = JSON.stringify(invoicePaid());
    const sig = stripe.webhooks.generateTestHeaderString({ payload: p, secret: SECRET });
    expect((await POST(req(p.replace("in_1", "in_2"), sig))).status).toBe(400);
  });
  it("valid signature -> 200", async () => {
    const { db } = fakeDb({ subRowAfter: 1 });
    const r = await POST(signed(invoicePaid()));
    expect(r.status).toBe(200);
    expect(total(db.ledger)).toBe(7500);
    expect(retrieveMock).not.toHaveBeenCalled();
  });
});
describe("plan amounts", () => {
  it("pro_builder_beta grants 18000", async () => {
    const { db, sb } = fakeDb({ subRowAfter: 1 });
    sb._plan = "pro_builder_beta";
    await POST(signed(invoicePaid()));
    expect(total(db.ledger)).toBe(18000);
  });
  it("missing plan metadata resolves Pro from the price and does not grant 7500", async () => {
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_local";
    const { db } = fakeDb();
    const evt = {
      id: "evt_price_pro",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_price_pro",
          status: "active",
          customer: "cus_1",
          metadata: { clerk_id: "user_123" },
          items: { data: [{ price: { id: "price_pro_local" }, current_period_start: 1700000000, current_period_end: 1702678400 }] },
        },
      },
    };
    const res = await POST(signed(evt));
    expect(res.status).toBe(200);
    expect(db.upserts[0]?.row.plan).toBe("pro_builder_beta");
    delete process.env.STRIPE_PRICE_PRO_BUILDER_BETA;
  });
  it("unresolvable plan -> 500, no creator_beta write", async () => {
    delete process.env.STRIPE_PRICE_CREATOR_BETA;
    delete process.env.STRIPE_PRICE_PRO_BUILDER_BETA;
    const { db } = fakeDb();
    const evt = {
      id: "evt_no_plan",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_no_plan",
          status: "active",
          customer: "cus_1",
          metadata: { clerk_id: "user_123" },
          items: { data: [{ price: { id: "price_unknown" } }] },
        },
      },
    };
    expect((await POST(signed(evt))).status).toBe(500);
    expect(db.upserts).toHaveLength(0);
    expect(db.events.size).toBe(0);
  });
});
describe("idempotency", () => {
  it("same event twice -> one grant, replayed", async () => {
    const { db } = fakeDb({ subRowAfter: 1 });
    await POST(signed(invoicePaid()));
    const r2 = await POST(signed(invoicePaid()));
    expect((await r2.json()).replayed).toBe(true);
    expect(total(db.ledger)).toBe(7500);
  });
  it("different event id, same invoice -> one grant", async () => {
    const { db } = fakeDb({ subRowAfter: 1 });
    await POST(signed(invoicePaid("evt_a")));
    await POST(signed(invoicePaid("evt_b")));
    expect(db.ledger.size).toBe(1);
    expect(total(db.ledger)).toBe(7500);
  });
});
describe("failures", () => {
  it("grant RPC error -> 500, event not marked processed", async () => {
    const { db } = fakeDb({ subRowAfter: 1, grantError: true });
    expect((await POST(signed(invoicePaid()))).status).toBe(500);
    expect(db.events.size).toBe(0);
  });
  it("credit pack grant RPC error -> 500, event not marked processed", async () => {
    const { db } = fakeDb({ grantError: true });
    const evt = {
      id: "evt_pack",
      type: "checkout.session.completed",
      data: { object: { id: "cs_pack_123456", metadata: { clerk_id: "user_123", coin_amount: "4000", product_type: "credit_pack" } } },
    };
    expect((await POST(signed(evt))).status).toBe(500);
    expect(db.events.size).toBe(0);
    expect(db.ledger.size).toBe(0);
  });
});
describe("race retry budget", () => {
  it("row appears on 4th lookup -> grants once", async () => {
    vi.useFakeTimers();
    const { db } = fakeDb({ subRowAfter: 4 });
    const p = POST(signed(invoicePaid()));
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.status).toBe(200);
    expect(db.subLookups).toBe(4);
    expect(total(db.ledger)).toBe(7500);
    expect(retrieveMock).not.toHaveBeenCalled();
  });
  it("row never appears -> 6 lookups, exactly 5 x 2s sleeps (10s), then 500", async () => {
    vi.useFakeTimers();
    const { db } = fakeDb({});
    const spy = vi.spyOn(globalThis, "setTimeout");
    const p = POST(signed(invoicePaid()));
    await vi.runAllTimersAsync();
    const r = await p;
    const sleeps = spy.mock.calls.filter((c) => c[1] === 2000).length;
    expect(db.subLookups).toBe(6);
    expect(sleeps).toBe(5);
    expect(r.status).toBe(500);
    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(db.events.size).toBe(0);
    expect(db.ledger.size).toBe(0);
  });
  it("fallback upsert conflicts on user_id and grants the resolved plan once", async () => {
    vi.useFakeTimers();
    process.env.STRIPE_PRICE_PRO_BUILDER_BETA = "price_pro_fallback";
    retrieveMock.mockResolvedValue({
      id: "sub_1",
      status: "active",
      metadata: { clerk_id: "user_123" },
      items: { data: [{ price: { id: "price_pro_fallback" }, current_period_start: 1700000000, current_period_end: 1702678400 }] },
    });
    const { db } = fakeDb({});
    const p = POST(signed(invoicePaid("evt_fallback", "in_fallback")));
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.status).toBe(200);
    expect(db.upserts[0]?.onConflict).toBe("user_id");
    expect(db.upserts[0]?.row.plan).toBe("pro_builder_beta");
    expect(total(db.ledger)).toBe(18000);
    delete process.env.STRIPE_PRICE_PRO_BUILDER_BETA;
  });
});
