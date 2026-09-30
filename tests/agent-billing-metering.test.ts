/**
 * Canonical metering (P0) — settleRun token-level events.
 *
 * settleRun must attach token-level provider-cost evidence to every
 * settlement while preserving the P0 invariant (exactly ONE billable
 * usage_event per logical action — here: one agent run):
 *
 *   - No billable attempt event exists for the run (usage_events by
 *     run_id) -> emit one token-level event (capability "llm",
 *     provider/model from the run's reservation-time input JSON),
 *     billable=true ONLY on the successful attempt, with
 *     ledgerIdempotencyKey so the settle's debit row links to it.
 *   - A billable attempt event already exists -> do NOT emit a duplicate;
 *     link the ledger debit (credit_ledger.usage_event_id) to the
 *     existing event instead.
 *   - Metering failures must never break settlement.
 *
 * `@/lib/metering` and `@/lib/supabase` are mocked; settleRun runs for
 * real. This file must not alter tests/agent-billing.test.ts — the mock
 * shapes there intentionally return undefined for `.select()` chains, and
 * the emission helper degrades to a no-op in that case.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const { emitUsageEventMock } = vi.hoisted(() => ({
  emitUsageEventMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { rpc: mockRpc, from: mockFrom },
}));

vi.mock("@/lib/metering", () => ({
  emitUsageEvent: emitUsageEventMock,
  getMeteringContext: vi.fn(() => null),
  runWithMeteringContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

const { settleRun } = await import("@/lib/agent-billing");

const RUN_ID = "run-1";
const SETTLE_KEY = `${RUN_ID}:settle`;

// Chainable stub: .eq/.order/.limit return self; .maybeSingle resolves `final`.
function chainable(final: unknown) {
  const self: Record<string, (...args: unknown[]) => unknown> = {};
  self.eq = () => self;
  self.order = () => self;
  self.limit = () => self;
  self.maybeSingle = () => Promise.resolve(final);
  return self;
}

function mockChains(opts: {
  /** Row returned by usage_events lookup, or null when none exists. */
  existingUsageEvent: { usage_event_id: string } | null;
  /** Throw inside the agent_runs select chain (metering lookup failure). */
  meteringLookupThrows?: boolean;
}) {
  const creditLedgerUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  mockFrom.mockImplementation((table: string) => {
    if (table === "agent_runs") {
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        select: opts.meteringLookupThrows
          ? vi.fn().mockImplementation(() => {
              throw new Error("db down");
            })
          : vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    user_id: "user-uuid-1",
                    input: { provider: "openrouter", model: "qwen/qwen3-coder:free" },
                  },
                  error: null,
                }),
              }),
            }),
      };
    }
    if (table === "usage_events") {
      return { select: vi.fn().mockReturnValue(chainable({ data: opts.existingUsageEvent, error: null })) };
    }
    if (table === "credit_ledger") {
      return { update: creditLedgerUpdate };
    }
    return {};
  });
  return { creditLedgerUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
  emitUsageEventMock.mockResolvedValue({ status: "ok", usageEventId: "ue-settle-1" });
  mockRpc.mockResolvedValue({
    data: { success: true, settled_amount: 42, released_amount: 58 },
    error: null,
  });
});

describe("settleRun canonical metering (P0)", () => {
  it("emits a token-level event with ledger linkage when no prior billable event exists", async () => {
    mockChains({ existingUsageEvent: null });

    const result = await settleRun(
      RUN_ID,
      { inputTokens: 1200, outputTokens: 3400, actualCredits: 42, status: "completed" },
      100,
      "res-1",
    );

    expect(result.ok).toBe(true);
    expect(result.creditsCharged).toBe(42);

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = emitUsageEventMock.mock.calls[0][0];
    expect(payload.userId).toBe("user-uuid-1");
    expect(payload.runId).toBe(RUN_ID);
    expect(payload.capability).toBe("llm");
    expect(payload.feature).toBe("studio-chat");
    // Provider/model come from the run's reservation-time input JSON.
    expect(payload.provider).toBe("openrouter");
    expect(payload.model).toBe("qwen/qwen3-coder:free");
    expect(payload.inputTokens).toBe(1200);
    expect(payload.outputTokens).toBe(3400);
    // billable=true only on the successful attempt.
    expect(payload.status).toBe("success");
    expect(payload.billable).toBe(true);
    expect(payload.chargedBits).toBe(42);
    expect(payload.idempotencyKey).toBe(`metering:agent-run:${RUN_ID}`);
    expect(payload.originalRequestId).toBe(`metering:agent-run:${RUN_ID}`);
    // Links the settle's ledger debit row to this event.
    expect(payload.ledgerIdempotencyKey).toBe(SETTLE_KEY);
    expect(typeof payload.providerCostMicros).toBe("number");
  });

  it("links the ledger debit without emitting when a billable attempt event already exists", async () => {
    const { creditLedgerUpdate } = mockChains({
      existingUsageEvent: { usage_event_id: "ue-existing" },
    });

    const result = await settleRun(
      RUN_ID,
      { inputTokens: 1200, outputTokens: 3400, actualCredits: 42, status: "completed" },
      100,
      "res-1",
    );

    expect(result.ok).toBe(true);
    // P0 invariant: no duplicate billable event for the same action.
    expect(emitUsageEventMock).not.toHaveBeenCalled();
    // ...but the ledger debit is linked to the existing event.
    expect(creditLedgerUpdate).toHaveBeenCalledWith({ usage_event_id: "ue-existing" });
    expect(creditLedgerUpdate().eq).toHaveBeenCalledWith("idempotency_key", SETTLE_KEY);
  });

  it("emits a non-billable event for a failed run with no prior billable event", async () => {
    mockChains({ existingUsageEvent: null });
    mockRpc.mockResolvedValue({ error: null });

    const result = await settleRun(
      RUN_ID,
      {
        inputTokens: 800,
        outputTokens: 0,
        actualCredits: 0,
        status: "failed",
        error: "provider timeout",
      },
      100,
      "res-1",
    );

    expect(result.ok).toBe(true);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const payload = emitUsageEventMock.mock.calls[0][0];
    // Failed attempts: billable=false, cost still captured.
    expect(payload.status).toBe("failed");
    expect(payload.billable).toBe(false);
    expect(payload.error).toBe("provider timeout");
    expect(payload.idempotencyKey).toBe(`metering:agent-run:${RUN_ID}`);
    expect(payload.originalRequestId).toBe(`metering:agent-run:${RUN_ID}`);
  });

  it("never breaks settlement when metering lookups fail", async () => {
    mockChains({ existingUsageEvent: null, meteringLookupThrows: true });

    const result = await settleRun(
      RUN_ID,
      { inputTokens: 1200, outputTokens: 3400, actualCredits: 42, status: "completed" },
      100,
      "res-1",
    );

    expect(result.ok).toBe(true);
    expect(result.creditsCharged).toBe(42);
    expect(emitUsageEventMock).not.toHaveBeenCalled();
  });
});
