// @vitest-environment node
/**
 * Hard spend/runaway guard tests.
 *
 * The Supabase admin client is replaced with a minimal in-memory fake
 * that supports exactly the query shapes spend-guards uses:
 *   from().select().eq()        -> thenable { data, error }
 *   from().select().eq().gte()  -> thenable { data, error }
 *   from().select().in()        -> thenable { data, error }
 * Nothing more — the fake stays honest because the module never chains
 * anything else.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, any>;

// ─── In-memory fake DB ────────────────────────────────────────────────

const db: Record<string, Row[]> = { usage_events: [], cost_events: [] };
let dbBroken = false;

function makeChain(table: string): any {
  const filters: Array<(r: Row) => boolean> = [];
  const apply = (): Row[] => {
    if (dbBroken) throw new Error("simulated DB outage");
    return (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  };
  const api: any = {
    select: (_cols: string) => api,
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    gte: (col: string, val: string) => {
      filters.push((r) => String(r[col]) >= val);
      return api;
    },
    in: (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return api;
    },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    // Minimal thenable so `await chain` works exactly like supabase-js.
    then: (onFulfilled: any, onRejected?: any) => {
      try {
        return Promise.resolve({ data: apply(), error: null }).then(
          onFulfilled,
          onRejected,
        );
      } catch (e) {
        return Promise.reject(e).then(onFulfilled, onRejected);
      }
    },
  };
  return api;
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => makeChain(t) }),
}));

import {
  checkRunawayGuards,
  withSpendGuard,
  SpendGuardError,
  RUN_SPEND_CEILING_MICROS,
  USER_HOURLY_CEILING_MICROS,
  USER_DAILY_CEILING_MICROS,
  OWNER_DAILY_CEILING_MICROS,
} from "./spend-guards";

// ─── Seed helpers ─────────────────────────────────────────────────────

let seq = 0;
const USER_A = "aaaaaaaa-1111-2222-3333-444444444444";
const OWNER_UUID = "bbbbbbbb-1111-2222-3333-444444444444";

function seedEvent(opts: {
  userId: string;
  originalRequestId?: string | null;
  minutesAgo: number;
  costMicros: number;
}) {
  const id = `evt-${++seq}`;
  db.usage_events.push({
    usage_event_id: id,
    user_id: opts.userId,
    original_request_id: opts.originalRequestId ?? null,
    created_at: new Date(Date.now() - opts.minutesAgo * 60_000).toISOString(),
  });
  db.cost_events.push({
    usage_event_id: id,
    provider_cost_micros: opts.costMicros,
  });
  return id;
}

beforeEach(() => {
  db.usage_events.length = 0;
  db.cost_events.length = 0;
  dbBroken = false;
  seq = 0;
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
});

// ─── Tests ────────────────────────────────────────────────────────────

describe("spend guard ceilings", () => {
  it("exports the documented ceiling values in USD micros", () => {
    expect(RUN_SPEND_CEILING_MICROS).toBe(5_000_000);
    expect(USER_HOURLY_CEILING_MICROS).toBe(20_000_000);
    expect(USER_DAILY_CEILING_MICROS).toBe(50_000_000);
    expect(OWNER_DAILY_CEILING_MICROS).toBe(200_000_000);
  });

  it("allows a call when all spend is well under the ceilings", async () => {
    seedEvent({ userId: USER_A, originalRequestId: "req-ok", minutesAgo: 30, costMicros: 1_000_000 });
    seedEvent({ userId: USER_A, originalRequestId: "req-ok2", minutesAgo: 90, costMicros: 2_000_000 });
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "studio-chat",
      originalRequestId: "req-ok",
    });
    expect(res).toEqual({ allowed: true });
  });

  it("blocks when a single failover chain (per-run) exceeds $5 provider cost", async () => {
    seedEvent({ userId: USER_A, originalRequestId: "req-runaway", minutesAgo: 20, costMicros: 3_000_000 });
    seedEvent({ userId: USER_A, originalRequestId: "req-runaway", minutesAgo: 15, costMicros: 3_000_001 });
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "image-gen",
      originalRequestId: "req-runaway",
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.reason).toBe("per-run-ceiling");
      expect(res.detail).toContain("req-runaway");
    }
  });

  it("blocks the call when estimated cost pushes a run over the per-run ceiling", async () => {
    seedEvent({ userId: USER_A, originalRequestId: "req-hot", minutesAgo: 10, costMicros: 4_500_000 });
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "video-gen",
      originalRequestId: "req-hot",
      estimatedCostMicros: 1_000_000, // $4.50 + $1.00 > $5.00
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.reason).toBe("per-run-ceiling");
  });

  it("blocks when a user exceeds $20 provider cost in a rolling 60 minutes", async () => {
    // 5 separate runs (each $4.10 — under the $5 per-run ceiling)
    for (let i = 0; i < 5; i++) {
      seedEvent({
        userId: USER_A,
        originalRequestId: `req-h-${i}`,
        minutesAgo: 10 + i,
        costMicros: 4_100_000,
      });
    }
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "studio-chat",
      originalRequestId: "req-h-0", // $4.10 run — per-run check passes
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.reason).toBe("hourly-ceiling");
      expect(res.detail).toContain("60 minutes");
    }
  });

  it("blocks when a user exceeds $50 provider cost in a rolling 24 hours (but not in the last hour)", async () => {
    // $1 in the last hour (hourly check passes), $55 two hours ago.
    seedEvent({ userId: USER_A, originalRequestId: "req-d-1", minutesAgo: 30, costMicros: 1_000_000 });
    seedEvent({ userId: USER_A, originalRequestId: "req-d-2", minutesAgo: 120, costMicros: 55_000_000 });
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "studio-chat",
      originalRequestId: "req-d-1",
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.reason).toBe("daily-ceiling");
      expect(res.detail).toContain("24 hours");
    }
  });

  it("owner gets the higher daily ceiling but is still capped", async () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "clerk-owner";
    const asOwner = (input: Record<string, any>) => ({
      ...input,
      userId: OWNER_UUID,
      clerkId: "clerk-owner",
      feature: "studio-chat",
    });

    // $150/day — over the $50 customer daily ceiling, under the $200 owner ceiling.
    seedEvent({ userId: OWNER_UUID, minutesAgo: 120, costMicros: 150_000_000 });
    expect(await checkRunawayGuards(asOwner({}))).toEqual({ allowed: true });

    // Push to $201/day — over the owner ceiling. Seeded >60 minutes
    // ago so the owner's $50 hourly ceiling (checked first) doesn't trip.
    seedEvent({ userId: OWNER_UUID, minutesAgo: 130, costMicros: 51_000_000 });
    const res = await checkRunawayGuards(asOwner({}));
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.reason).toBe("daily-ceiling");
      expect(res.detail).toContain("200.00");
    }
  });
});

describe("bypasses and fail-open behavior", () => {
  it("BYOK usage bypasses every guard, even deep into runaway territory", async () => {
    seedEvent({ userId: USER_A, originalRequestId: "req-byok", minutesAgo: 10, costMicros: 400_000_000 });
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "studio-chat",
      originalRequestId: "req-byok",
      isByok: true,
    });
    expect(res).toEqual({ allowed: true });
  });

  it("fails open (allowed, no throw) when the guard queries error", async () => {
    dbBroken = true;
    const res = await checkRunawayGuards({
      userId: USER_A,
      clerkId: "clerk-user-a",
      feature: "studio-chat",
      originalRequestId: "req-anything",
    });
    expect(res).toEqual({ allowed: true });

    // And the wrapped fn still runs.
    const fn = vi.fn(async () => "still-works");
    await expect(withSpendGuard({ feature: "studio-chat" }, fn)).resolves.toBe(
      "still-works",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withSpendGuard", () => {
  it("runs and returns the fn result when the call is allowed", async () => {
    seedEvent({ userId: USER_A, originalRequestId: "req-fine", minutesAgo: 5, costMicros: 500_000 });
    const fn = vi.fn(async () => ({ ok: 1 }));
    await expect(
      withSpendGuard(
        { userId: USER_A, clerkId: "clerk-user-a", feature: "tts", originalRequestId: "req-fine" },
        fn,
      ),
    ).resolves.toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws a named SpendGuardError without running the fn when blocked", async () => {
    seedEvent({ userId: USER_A, originalRequestId: "req-blocked", minutesAgo: 5, costMicros: 6_000_000 });
    const fn = vi.fn(async () => "should-never-run");
    const p = withSpendGuard(
      {
        userId: USER_A,
        clerkId: "clerk-user-a",
        feature: "image-gen",
        originalRequestId: "req-blocked",
      },
      fn,
    );
    await expect(p).rejects.toBeInstanceOf(SpendGuardError);
    await expect(p).rejects.toMatchObject({ name: "SpendGuardError" });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(SpendGuardError);
    expect(err.result.reason).toBe("per-run-ceiling");
    expect(typeof err.message).toBe("string");
    expect(err.message).toContain("per-run-ceiling");
    expect(fn).not.toHaveBeenCalled();
  });
});
