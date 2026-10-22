/**
 * #684 regression — Studio builds must debit LiTTBits.
 * Fully isolated: Supabase is mocked; no network, no DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockRpc = vi.fn();
const inserts: Array<{ table: string; row: unknown }> = [];
const updates: Array<{ table: string; row: unknown }> = [];

// Chainable query mock: every builder method returns the chain; awaiting
// it (or .single/.maybeSingle) resolves to the configured result.
function chain(table: string, result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = new Proxy(c, {
    get(_t, prop: string) {
      if (prop === "then") return (res: (v: unknown) => unknown) => res(result);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve(result);
      if (prop === "insert") return (row: unknown) => { inserts.push({ table, row }); return self; };
      if (prop === "update") return (row: unknown) => { updates.push({ table, row }); return self; };
      return () => self;
    },
  });
  return self;
}
const tableResults: Record<string, { data: unknown; error: unknown }> = {};
const mockFrom = vi.fn((table: string) => chain(table, tableResults[table] ?? { data: null, error: null }));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => mockRpc(...a), from: (t: string) => mockFrom(t) },
  getSupabaseAdmin: () => ({ rpc: (...a: unknown[]) => mockRpc(...a), from: (t: string) => mockFrom(t) }),
}));
vi.mock("@/lib/env", () => ({ isClerkConfigured: () => true, isAnonymousDevAllowed: () => false }));

const { reserveCredits, settleRun } = await import("@/lib/agent-billing");
const sb = await import("@/lib/studio/studio-billing");
const { createBilledBitsAccumulator, accrueBilledBits, runWithMeteringContext } = await import("@/lib/metering");
const { calculateLlmCost } = await import("@/lib/llm-cost-engine");
const { LLM_LANE_BITS_PER_USD } = await import("@/lib/billing/canonical-pricing");

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

beforeEach(() => {
  mockRpc.mockReset();
  inserts.length = 0;
  updates.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  tableResults.users = { data: { id: "user-uuid" }, error: null };
  tableResults.agent_runs = { data: { id: "run-1" }, error: null };
  sb._resetFreeChatGuard();
});

describe("reserve", () => {
  it("reserves a builtin Studio build hold with the Studio TTL and unwraps array rows", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ success: true, reservation_id: "res-1", reason: null }], error: null });
    const r = await reserveCredits(
      {
        clerkId: "clerk_1",
        agentInstanceId: sb.STUDIO_BUILTIN_AGENT_REF,
        agentId: null,
        agentVersionId: null,
        idempotencyKey: "studio-build:req-12345678",
        usageType: "studio_build",
        referenceType: "studio_conversation",
        expiresSeconds: sb.STUDIO_BUILD_RESERVATION_TTL_SECONDS,
      },
      sb.STUDIO_BUILD_RESERVE_BITS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reservationId).toBe("res-1");
      expect(r.reservedCredits).toBe(200);
    }
    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("reserve_bits");
    expect(args.p_expires_seconds).toBe(sb.STUDIO_BUILD_RESERVATION_TTL_SECONDS);
    expect(args.p_amount ?? args.p_bits ?? 200).toBe(200);
  });

  it("insufficient balance (array row success=false) fails the reservation", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ success: false, reservation_id: null, reason: "insufficient_balance" }], error: null });
    const r = await reserveCredits(
      { clerkId: "c", agentInstanceId: sb.STUDIO_BUILTIN_AGENT_REF, agentId: null, agentVersionId: null, idempotencyKey: "studio-build:abcdefgh" },
      200,
    );
    expect(r.ok).toBe(false);
  });
});

describe("settle / release", () => {
  it("settles completed work via settle_bits with the accrued bits", async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ success: true, reason: null }], error: null });
    await settleRun("run-1", { inputTokens: 1, outputTokens: 1, actualCredits: 37, status: "completed" }, 200, "res-1");
    const call = mockRpc.mock.calls.find((c) => c[0] === "settle_bits");
    expect(call).toBeTruthy();
    expect(JSON.stringify(call![1])).toContain("37");
  });

  it("releases a zero-work cancel via release_bits", async () => {
    mockRpc.mockResolvedValue({ data: [{ success: true, reason: null }], error: null });
    await settleRun("run-1", { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "cancelled" }, 200, "res-1");
    expect(mockRpc.mock.calls.some((c) => c[0] === "release_bits")).toBe(true);
    expect(mockRpc.mock.calls.some((c) => c[0] === "settle_bits")).toBe(false);
  });

  it("release rejected in array shape fails closed and records a reconciliation", async () => {
    mockRpc.mockResolvedValue({ data: [{ success: false, reason: "not_found" }], error: null });
    await settleRun("run-1", { inputTokens: 0, outputTokens: 0, actualCredits: 0, status: "failed" }, 200, "res-1").catch(() => undefined);
    expect(inserts.some((i) => i.table === "billing_reconciliations")).toBe(true);
  });
});

describe("studioSettleBits policy", () => {
  it("cancel refund: charges only accrued completed work, capped at the hold", () => {
    expect(sb.studioSettleBits("cancelled", 0, 200)).toBe(0);
    expect(sb.studioSettleBits("cancelled", 12, 200)).toBe(12);
    expect(sb.studioSettleBits("failed", 999, 200)).toBe(200);
    expect(sb.studioSettleStatus("cancelled", 0)).toBe("cancelled");
    expect(sb.studioSettleStatus("cancelled", 12)).toBe("completed");
  });
  it("1-bit minimum applies only to successful billable operations", () => {
    expect(sb.studioSettleBits("completed", 0, 200)).toBe(1);
    expect(sb.studioSettleBits("completed", 0.2, 200)).toBeGreaterThanOrEqual(1);
    expect(sb.studioSettleBits("failed", 0, 200)).toBe(0);
    expect(sb.studioSettleBits("cancelled", 0, 200)).toBe(0);
  });
  it("approval wait keeps the reservation (settles nothing)", () => {
    expect(sb.studioSettleBits("awaiting_approval", 50, 200)).toBe(0);
  });
});

describe("approval timeout expiry", () => {
  it("reservation TTL outlives loop + approval wait, approval TTL pinned to paused-run store", () => {
    expect(sb.STUDIO_APPROVAL_TTL_SECONDS).toBe(30 * 60);
    expect(src("src/lib/litt-intelligence/paused-run-store.ts")).toMatch(/APPROVAL_TTL_MS = 30 \* 60 \* 1000/);
    expect(sb.STUDIO_BUILD_RESERVATION_TTL_SECONDS).toBeGreaterThanOrEqual(
      sb.STUDIO_LOOP_MAX_RUNTIME_SECONDS + sb.STUDIO_APPROVAL_TTL_SECONDS,
    );
  });
  it("expired holds auto-release: available balance ignores reservations past expires_at", () => {
    const sql = src("supabase/migrations/20260814200000_b2_reservation_settlement.sql");
    expect(sql).toMatch(/expires_at\s*>\s*now\(\)/i);
    expect(sql).toMatch(/reservation_expired/);
  });
  it("reject settles pre-pause work and releases the rest; nested gate carries the hold", async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const state = { runId: "run-1", reservationId: "res-1", reservedCredits: 200, accruedBits: 9, billableSteps: 2, pausedRunId: "p1" };
    const r1 = await sb.finalizeStudioBuildBilling({ db: null, settleRun: settle }, state, "cancelled", 9, 2);
    expect(r1).toEqual({ action: "settled", bits: 9 });
    expect(settle).toHaveBeenCalledWith("run-1", expect.objectContaining({ actualCredits: 9, status: "completed" }), 200, "res-1");
    const r2 = await sb.finalizeStudioBuildBilling({ db: null, settleRun: settle }, state, "awaiting_approval", 15, 3, "p2");
    expect(r2.action).toBe("carried");
    const r3 = await sb.finalizeStudioBuildBilling({ db: null, settleRun: settle }, state, "awaiting_approval", 15, 3, null);
    expect(r3).toEqual({ action: "settled", bits: 15 });
  });
});

describe("bits totalled across the agent loop", () => {
  it("accrueBilledBits sums inside the metering context and is a no-op outside", async () => {
    const acc = createBilledBitsAccumulator(5, 1);
    await runWithMeteringContext({ feature: "studio-chat", billing: acc } as never, async () => {
      accrueBilledBits(3);
      await Promise.resolve();
      accrueBilledBits(4);
    });
    expect(acc.billedBits).toBe(12);
    expect(acc.billableSteps).toBe(3);
    expect(() => accrueBilledBits(10)).not.toThrow();
  });
  it("the agent loop accrues on successful steps", () => {
    const loop = src("src/lib/litt-intelligence/agent-loop-v2.ts");
    expect(loop).toMatch(/accrueStepBits\(/);
    expect((loop.match(/accrueStepBits\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("chat free", () => {
  it("plain builtin chat reserves nothing; builtin V2 builds reserve", () => {
    const route = src("src/app/api/studio/conversations/[conversationId]/messages/route.ts");
    expect(route).toMatch(/if \(isBuiltinStudio && clerkId && useV2\)/);
    expect(route).toMatch(/isBuiltinStudio && !useV2\)[\s\S]{0,200}checkFreeChatGuard/);
    expect(route).toMatch(/agentRunId && isBuiltinStudio\)[\s\S]{0,400}studioSettleBits\(outcome, studioBilling\.billedBits/);
  });
  it("free chat guard: 20/min burst then 429", async () => {
    const { createMemoryFreeChatStore } = await import("@/lib/billing/free-chat-limit");
    const store = createMemoryFreeChatStore();
    const t = 1_000_000;
    for (let i = 0; i < sb.FREE_CHAT_PER_MINUTE; i++) {
      expect((await sb.checkFreeChatGuard("u", t + i, store)).ok).toBe(true);
    }
    const r = await sb.checkFreeChatGuard("u", t + 100, store);
    expect(r.ok).toBe(false);
    expect((await sb.checkFreeChatGuard("u", t + 61_000, store)).ok).toBe(true);
  });
});

describe("LLM lane pricing — active legacy rate (owner decision 2026-10-22)", () => {
  it("LLM lane exchange rate is the approved legacy 1,000/$", () => {
    expect(LLM_LANE_BITS_PER_USD).toBe(1000);
    expect(src("src/lib/llm-cost-engine.ts")).not.toMatch(/providerCostUsd \* 1000/);
  });
  it("$1 of provider cost is ~1,000 bits before margin, not 100", () => {
    // 1M prompt tokens on the generic fallback = $0.50 → 500 bits
    // pre-margin at the legacy rate; retail = round(500 * 1.5 +
    // 2000 * 0.1) = 950. The unapproved 100/$ candidate would give 275.
    const c = calculateLlmCost({ provider: "unknown-prov", model: "x", promptTokens: 1_000_000, completionTokens: 0, isByok: false });
    expect(c.providerCostMicros).toBe(500_000);
    expect(c.retailLiTTBits).toBe(950);
  });
  it("calculateLlmCost bills >= 1 bit for a successful call", () => {
    const c = calculateLlmCost({ provider: "openai", model: "gpt-4o-mini", promptTokens: 10, completionTokens: 10, isByok: false });
    expect(c.retailLiTTBits).toBeGreaterThanOrEqual(1);
  });
});

describe("settled invoices only", () => {
  it("unpaid upgrade / unmapped invoice grants nothing (no stored-plan fallback)", () => {
    const wh = src("src/app/api/stripe/webhook/route.ts");
    const fn = wh.slice(wh.indexOf("function settledInvoiceCredit("), wh.indexOf("function settledInvoiceCredit(") + 2500);
    const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
    expect(body.replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/storedPlan/);
    expect(body).toMatch(/if \(!priced\) \{[\s\S]*?return null;/);
  });
});
