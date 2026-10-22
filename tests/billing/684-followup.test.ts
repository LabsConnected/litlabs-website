/**
 * #684 follow-ups: abandoned-hold races, shared free-chat limit,
 * disabled reservation sweep, unapproved 100/$ policy, cost labels.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { settleAbandonedStudioHold } from "@/lib/studio/studio-billing";
import {
  consumeFreeChat,
  createMemoryFreeChatStore,
  FREE_CHAT_PER_DAY,
  FREE_CHAT_PER_MINUTE,
} from "@/lib/billing/free-chat-limit";
import { runReservationSweep } from "@/lib/billing/reservation-sweep";
import {
  ACTIVE_LLM_POLICY_ID,
  LEGACY_EXCHANGE_POLICY_ID,
  LEGACY_LLM_BITS_PER_USD,
  PRICING_POLICIES,
  UNAPPROVED_EXCHANGE_POLICY_ID,
  UNAPPROVED_LLM_BITS_PER_USD,
} from "@/lib/billing/pricing-policy";
import { calculateLlmCost, getEstimatedBitsRange } from "@/lib/llm-cost-engine";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

interface HoldDb {
  debits: number[];
  phase: string;
  from: (table: string) => {
    select: () => unknown;
    eq: (col: string, val: string) => unknown;
    update: (row: { studio_billing: { phase: string } }) => unknown;
    maybeSingle: () => Promise<{ data: { id: string; output?: unknown } | null; error: null }>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
}

function holdDb(opts?: { accrued?: number; settleReason?: string }): HoldDb {
  let phase = "awaiting_approval";
  let status = "reserved";
  const debits: number[] = [];
  const accrued = opts?.accrued ?? 12;
  const db: HoldDb = {
    debits,
    get phase() {
      return phase;
    },
    from() {
      const filters: Record<string, string> = {};
      let pending: { studio_billing: { phase: string } } | null = null;
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return chain;
        },
        update: (row: { studio_billing: { phase: string } }) => {
          pending = row;
          return chain;
        },
        maybeSingle: async () => {
          if (pending) {
            const fromPhase = filters["output->studio_billing->>phase"];
            if (phase !== fromPhase) {
              pending = null;
              return { data: null, error: null };
            }
            phase = pending.studio_billing.phase;
            pending = null;
            return { data: { id: "run-1" }, error: null };
          }
          if (filters["output->studio_billing->>paused_run_id"] && phase !== "awaiting_approval") {
            return { data: null, error: null };
          }
          return {
            data: {
              id: "run-1",
              output: {
                studio_billing: {
                  phase,
                  paused_run_id: "pause-1",
                  reservation_id: "11111111-1111-1111-1111-111111111111",
                  reserved_credits: 200,
                  accrued_bits: accrued,
                  billable_steps: 2,
                },
              },
            },
            error: null,
          };
        },
      };
      return chain;
    },
    rpc: async (fn, args) => {
      if (opts?.settleReason === "reservation_expired" && fn === "settle_bits") {
        return { data: [{ success: false, reason: "reservation_expired", settled_amount: 0 }], error: null };
      }
      if (fn === "settle_bits") {
        if (status !== "reserved") {
          return { data: [{ success: true, reason: "already_settled", settled_amount: debits[0] ?? 0 }], error: null };
        }
        status = "settled";
        debits.push(Number(args.p_actual_amount));
        return { data: [{ success: true, reason: "settled", settled_amount: Number(args.p_actual_amount) }], error: null };
      }
      if (fn === "release_bits") {
        if (status !== "reserved") {
          return { data: [{ success: true, reason: "already_released" }], error: null };
        }
        status = "released";
        return { data: [{ success: true, reason: "released" }], error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
  return db;
}

describe("abandoned approval settlement", () => {
  it("settles the pre-pause bits once", async () => {
    const db = holdDb();
    const result = await settleAbandonedStudioHold(db, "pause-1");
    expect(result).toEqual({ action: "settled", bits: 12 });
    expect(db.debits).toEqual([12]);
    expect(db.phase).toBe("expired_settled");
  });

  it("two overlapping cleanups debit once", async () => {
    const db = holdDb();
    const [a, b] = await Promise.all([
      settleAbandonedStudioHold(db, "pause-1"),
      settleAbandonedStudioHold(db, "pause-1"),
    ]);
    expect(db.debits).toEqual([12]);
    const actions = [a.action, b.action].sort();
    expect(actions).toEqual(["lost", "settled"]);
  });

  it("a late approve racing the cleanup debits once", async () => {
    const db = holdDb();
    const approve = db.rpc("settle_bits", {
      p_reservation_id: "11111111-1111-1111-1111-111111111111",
      p_actual_amount: 42,
    });
    const cleanup = settleAbandonedStudioHold(db, "pause-1");
    await Promise.all([approve, cleanup]);
    expect(db.debits).toHaveLength(1);
    expect([12, 42]).toContain(db.debits[0]);
  });

  it("releases the hold when no billable work was completed", async () => {
    const db = holdDb({ accrued: 0 });
    const result = await settleAbandonedStudioHold(db, "pause-1");
    expect(result).toEqual({ action: "released", bits: 0 });
    expect(db.debits).toEqual([]);
    expect(db.phase).toBe("expired_released");
  });

  it("puts the phase back when the reservation is already past expiry", async () => {
    const db = holdDb({ settleReason: "reservation_expired" });
    const result = await settleAbandonedStudioHold(db, "pause-1");
    expect(result.action).toBe("unavailable");
    expect(db.debits).toEqual([]);
    expect(db.phase).toBe("awaiting_approval");
  });
});

describe("shared free-chat limit", () => {
  it("allows 20 in one minute and denies the next", async () => {
    const store = createMemoryFreeChatStore();
    const t = 1_700_000_000_000;
    for (let i = 0; i < FREE_CHAT_PER_MINUTE; i++) {
      expect((await store.consume("user-a", t)).ok).toBe(true);
    }
    expect((await store.consume("user-a", t + 1000)).ok).toBe(false);
    expect((await store.consume("user-a", t + 61_000)).ok).toBe(true);
  });

  it("does not let parallel calls slip past the minute cap", async () => {
    const store = createMemoryFreeChatStore();
    const t = 1_700_000_000_000;
    const results = await Promise.all(
      Array.from({ length: 40 }, () => store.consume("user-b", t)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(FREE_CHAT_PER_MINUTE);
  });

  it("enforces the daily cap and does not count a denied hit", async () => {
    const store = createMemoryFreeChatStore();
    let now = 1_700_000_000_000;
    for (let i = 0; i < FREE_CHAT_PER_DAY; i++) {
      now += 61_000;
      expect((await store.consume("user-c", now)).ok).toBe(true);
    }
    const denied = await store.consume("user-c", now + 61_000);
    expect(denied.ok).toBe(false);
    expect((await store.consume("user-c", now + 120_000)).ok).toBe(false);
  });

  it("fails closed when the store is missing or throws", async () => {
    expect((await consumeFreeChat(null, "user-d")).ok).toBe(false);
    expect((await consumeFreeChat({
      consume: async () => {
        throw new Error("rpc missing");
      },
    }, "user-d")).ok).toBe(false);
  });
});

describe("reservation sweep is code-only", () => {
  it("does not call the database while the flag is off", async () => {
    const rpc = vi.fn();
    const result = await runReservationSweep({ rpc }, new Date(), {});
    expect(result).toEqual({ enabled: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls sweep_expired_reservations only when enabled", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ settled: 2, released: 1, expired: 4, skipped: 3 }],
      error: null,
    }));
    const result = await runReservationSweep({ rpc }, new Date("2026-10-22T00:00:00Z"), {
      BILLING_RESERVATION_SWEEP_ENABLED: "1",
    });
    expect(rpc).toHaveBeenCalledWith("sweep_expired_reservations", { p_now: "2026-10-22T00:00:00.000Z" });
    expect(result).toEqual({ enabled: true, settled: 2, released: 1, expired: 4, skipped: 3 });
  });

  it("ships the atomic SQL without scheduling it", () => {
    const sweep = src("supabase/migrations/20261022180000_sweep_expired_reservations.sql");
    const limit = src("supabase/migrations/20261022180100_free_chat_rate_limit.sql");
    const vercel = src("vercel.json");
    expect(sweep).toMatch(/FOR UPDATE OF cr SKIP LOCKED/);
    expect(sweep).toMatch(/status = 'reserved'/);
    expect(sweep).toMatch(/settle_bits\(/);
    expect(sweep).toMatch(/release_bits\(/);
    expect(sweep).not.toMatch(/cron\.schedule/);
    expect(limit).toMatch(/pg_advisory_xact_lock/);
    expect(limit).toMatch(/rate_limit_store/);
    expect(limit).not.toMatch(/cron\.schedule/);
    expect(vercel).not.toMatch(/sweep-expired-reservations/);
  });
});

describe("pricing policy versions", () => {
  it("keeps 1000/$ identifiable and marks 100/$ UNAPPROVED", () => {
    expect(PRICING_POLICIES["littbits-exchange-v1"].llmBitsPerUsd).toBe(LEGACY_LLM_BITS_PER_USD);
    expect(PRICING_POLICIES["littbits-exchange-v1"].llmBitsPerUsd).toBe(1000);
    expect(PRICING_POLICIES[UNAPPROVED_EXCHANGE_POLICY_ID].llmBitsPerUsd).toBe(UNAPPROVED_LLM_BITS_PER_USD);
    expect(PRICING_POLICIES[UNAPPROVED_EXCHANGE_POLICY_ID].llmBitsPerUsd).toBe(100);
    expect(PRICING_POLICIES[UNAPPROVED_EXCHANGE_POLICY_ID].approval).toBe("UNAPPROVED");
    expect(PRICING_POLICIES[UNAPPROVED_EXCHANGE_POLICY_ID].note).toMatch(/UNAPPROVED/);
  });

  it("active policy is the approved legacy policy (owner decision 2026-10-22, economics-neutral)", () => {
    // Regression guard: PR #726 must not silently activate the
    // unapproved 100/$ candidate. Flipping ACTIVE fails this test.
    expect(ACTIVE_LLM_POLICY_ID).toBe(LEGACY_EXCHANGE_POLICY_ID);
    expect(ACTIVE_LLM_POLICY_ID).not.toBe(UNAPPROVED_EXCHANGE_POLICY_ID);
    expect(PRICING_POLICIES[ACTIVE_LLM_POLICY_ID].llmBitsPerUsd).toBe(1000);
    expect(PRICING_POLICIES[ACTIVE_LLM_POLICY_ID].approval).toBe("legacy");
  });

  it("does not label a 1-bit paid estimate as Included", () => {
    const paid = getEstimatedBitsRange("groq", "openai/gpt-oss-120b", false);
    expect(paid.max).toBeGreaterThanOrEqual(1);
    expect(paid.label).not.toBe("Included");
  });
});

describe("economics figures used in docs/billing/684-economics.md", () => {
  it("matches the catalog math for the documented samples", () => {
    const groqChat = calculateLlmCost({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
    });
    const gptStep = calculateLlmCost({
      provider: "openai",
      model: "gpt-4o",
      promptTokens: 2000,
      completionTokens: 800,
      isByok: false,
    });
    const geminiChat = calculateLlmCost({
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptTokens: 1000,
      completionTokens: 500,
      isByok: false,
    });
    // Active legacy rate (1,000 bits/$) — the doc's 1,000/$ column.
    expect(groqChat.retailLiTTBits).toBe(2);
    expect(gptStep.retailLiTTBits).toBe(21);
    expect(geminiChat.retailLiTTBits).toBe(1);
    expect(groqChat.providerCostMicros).toBe(985);
    const doc = src("docs/billing/684-economics.md");
    expect(doc).toMatch(/UNAPPROVED/);
    expect(doc).toMatch(/7,500/);
    expect(doc).toMatch(/18,000/);
    expect(doc).toMatch(/1,500/);
    expect(doc).toMatch(/200/);
  });
});
