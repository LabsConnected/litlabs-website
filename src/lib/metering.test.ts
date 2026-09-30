// @vitest-environment node
/**
 * Canonical metering emitter tests — proves every provider attempt produces
 * exactly one usage_events row + one cost_events row, idempotently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const writes: Array<{ table: string; op: string; row: unknown }> = [];

function makeQueryChain(table: string) {
  const chain: Record<string, unknown> = {};
  const record = (op: string, row: unknown) => {
    writes.push({ table, op, row });
  };
  chain.upsert = vi.fn((row: unknown) => {
    record("upsert", row);
    return chain;
  });
  chain.insert = vi.fn((row: unknown) => {
    record("insert", row);
    return chain;
  });
  chain.update = vi.fn((row: unknown) => {
    record("update", row);
    return chain;
  });
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({
    data: { usage_event_id: "evt-123" },
    error: null,
  }));
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  return chain;
}

const fromMock = vi.fn((table: string) => makeQueryChain(table));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { emitUsageEvent, _clearMeteringUserCache } from "./metering";

const USER_UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  writes.length = 0;
  fromMock.mockClear();
  _clearMeteringUserCache();
  vi.clearAllMocks();
});

describe("emitUsageEvent", () => {
  it("writes one usage_events row + one cost_events row with the canonical shape", async () => {
    const res = await emitUsageEvent({
      userId: USER_UUID,
      feature: "studio-chat",
      capability: "llm",
      provider: "gemini",
      model: "gemini-2.5-flash",
      inputTokens: 1000,
      outputTokens: 200,
      providerCostMicros: 135000,
      retailBits: 12,
      chargedBits: 12,
      status: "success",
      idempotencyKey: "metering:llm:req-1:0",
      retrySequence: 0,
      originalRequestId: "req-1",
      ledgerIdempotencyKey: "llm:call-1",
    });

    expect(res.usageEventId).toBe("evt-123");
    expect(res.skipped).toBeUndefined();

    const usage = writes.find((w) => w.table === "usage_events");
    expect(usage).toBeDefined();
    expect(usage!.op).toBe("upsert");
    const row = usage!.row as Record<string, unknown>;
    expect(row.user_id).toBe(USER_UUID);
    expect(row.provider).toBe("gemini");
    expect(row.model).toBe("gemini-2.5-flash");
    expect(row.capability).toBe("llm");
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(200);
    expect(row.idempotency_key).toBe("metering:llm:req-1:0");
    expect(row.retry_sequence).toBe(0);
    expect(row.original_request_id).toBe("req-1");
    expect(row.billable).toBe(true);
    expect(row.billability_cause).toBe("feature:studio-chat");

    const cost = writes.find((w) => w.table === "cost_events");
    expect(cost).toBeDefined();
    expect((cost!.row as Record<string, unknown>).provider_cost_micros).toBe(135000);
    expect((cost!.row as Record<string, unknown>).usage_event_id).toBe("evt-123");

    // Ledger linkage stamped.
    const stamp = writes.find(
      (w) => w.table === "credit_ledger" && w.op === "update",
    );
    expect(stamp).toBeDefined();
  });

  it("records failed attempts with billable=false and the error, still capturing cost", async () => {
    const res = await emitUsageEvent({
      userId: USER_UUID,
      feature: "tts",
      capability: "speech",
      provider: "openai",
      model: "tts-1",
      providerCostMicros: 50000,
      status: "failed",
      error: "HTTP 500",
      idempotencyKey: "metering:tts:req-2:0",
    });

    expect(res.usageEventId).toBe("evt-123");
    const usage = writes.find((w) => w.table === "usage_events");
    const row = usage!.row as Record<string, unknown>;
    expect(row.billable).toBe(false);
    // Provider charged us but the user wasn't — LiTT absorbed it.
    expect(row.liitt_absorbed).toBe(true);
  });

  it("records free-model usage with $0 provider cost (metered, not invisible)", async () => {
    const res = await emitUsageEvent({
      userId: USER_UUID,
      feature: "chat-unified",
      capability: "llm",
      provider: "openrouter",
      model: "minimax/minimax-m3:free",
      inputTokens: 500,
      outputTokens: 100,
      providerCostMicros: 0,
      status: "success",
      idempotencyKey: "metering:llm:req-3:0",
    });

    expect(res.usageEventId).toBe("evt-123");
    const cost = writes.find((w) => w.table === "cost_events");
    expect((cost!.row as Record<string, unknown>).provider_cost_micros).toBe(0);
  });

  it("skips (never throws) when no user is resolvable", async () => {
    const res = await emitUsageEvent({
      feature: "unknown",
      capability: "llm",
      provider: "gemini",
      model: "gemini-2.5-flash",
      providerCostMicros: 0,
      status: "success",
      idempotencyKey: "metering:llm:req-4:0",
    });

    expect(res.usageEventId).toBeNull();
    expect(res.skipped).toBe("no-resolvable-user");
    expect(writes.length).toBe(0);
  });

  it("is replay-safe: same idempotency key upserts usage_events, does not duplicate cost_events", async () => {
    const input = {
      userId: USER_UUID,
      feature: "image-gen" as const,
      capability: "image" as const,
      provider: "fal",
      model: "flux-pro",
      imageCount: 1,
      providerCostMicros: 30000,
      status: "success" as const,
      idempotencyKey: "metering:image:req-5:0",
    };
    // First emission: cost_events empty → insert.
    await emitUsageEvent(input);
    // Second emission with same key: cost row already exists → no new insert.
    const costChain = makeQueryChain("cost_events");
    (
      costChain.maybeSingle as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { id: "cost-1" }, error: null });
    fromMock.mockImplementation((table: string) =>
      table === "cost_events" ? costChain : makeQueryChain(table),
    );
    await emitUsageEvent(input);

    const costInserts = writes.filter(
      (w) => w.table === "cost_events" && w.op === "insert",
    );
    expect(costInserts.length).toBe(1);
  });
});
