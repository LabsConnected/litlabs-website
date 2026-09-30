// @vitest-environment node
/**
 * P0 CORRECTNESS: provider retry/failover must increase LiTT's cost without
 * multiplying the customer's charge.
 *
 * Forces a failover (primary Gemini fails → OpenRouter fallback succeeds)
 * and asserts:
 *   - N cost_events (one per provider attempt — LiTT incurred the cost)
 *   - exactly ONE billable usage_event (the customer is charged once)
 *   - the failed attempt is recorded billable=false
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));
vi.mock("@/lib/metrics", () => ({
  recordLLMCall: vi.fn(),
}));

// ---- Supabase write recorder ----
interface Write {
  table: string;
  op: string;
  row: Record<string, unknown>;
}
const writes: Write[] = [];

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  const rec = (op: string) => (row: unknown) => {
    writes.push({ table, op, row: row as Record<string, unknown> });
    return chain;
  };
  chain.upsert = vi.fn(rec("upsert"));
  chain.insert = vi.fn(rec("insert"));
  chain.update = vi.fn(rec("update"));
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: { usage_event_id: `evt-${writes.length}` }, error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

// ---- Gemini SDK mock: primary FAILS ----
const generateContentMock = vi.fn();
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: generateContentMock }),
  })),
}));

import { generateText } from "./llm";

const USER_UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  writes.length = 0;
  vi.clearAllMocks();
  // Primary (Gemini) fails with a retryable 500.
  generateContentMock.mockRejectedValue(
    Object.assign(new Error("Gemini 500: Internal Server Error"), {
      status: 500,
    }),
  );
  // Fallback (OpenRouter via fetch) succeeds.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "fallback answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: "openrouter/fallback",
      }),
    })),
  );
});

describe("P0: failover metering invariant", () => {
  it("emits N cost_events (one per attempt) but exactly ONE billable usage_event", async () => {
    const res = await generateText("hello", {
      task: "chat",
      // Force a two-provider chain: gemini first, openrouter fallback.
      // defaultChain honors explicit provider ordering via category "auto".
      category: "auto",
      metering: { userId: USER_UUID, feature: "chat-unified" },
    });

    // Sanity: failover actually happened.
    expect(res.failover.length).toBeGreaterThan(0);
    expect(res.text).toBe("fallback answer");

    // Metering is fire-and-forget. Wait for observable writes instead of a
    // fixed sleep, which races module loading under parallel suite load.
    await vi.waitFor(() => {
      expect(writes.filter((w) => w.table === "cost_events").length).toBeGreaterThanOrEqual(2);
    });

    const usageWrites = writes.filter((w) => w.table === "usage_events");
    const costWrites = writes.filter((w) => w.table === "cost_events");

    // One usage_event per attempt.
    expect(usageWrites.length).toBeGreaterThanOrEqual(2);

    // Exactly ONE billable usage_event across all attempts.
    const billable = usageWrites.filter((w) => w.row.billable === true);
    expect(billable.length).toBe(1);

    // The failed attempt(s) are recorded but NOT billable.
    const nonBillable = usageWrites.filter((w) => w.row.billable === false);
    expect(nonBillable.length).toBeGreaterThanOrEqual(1);

    // All attempts share one logical action id.
    const requestIds = new Set(
      usageWrites.map((w) => w.row.original_request_id as string),
    );
    expect(requestIds.size).toBe(1);

    // Retry sequencing is present.
    const sequences = usageWrites
      .map((w) => w.row.retry_sequence as number)
      .sort((a, b) => a - b);
    expect(sequences[0]).toBe(0);

    // One cost_event per attempt — LiTT's real provider cost.
    expect(costWrites.length).toBe(usageWrites.length);

    // The billable event is the successful attempt.
    expect(billable[0].row.provider).toBe(res.provider);
  });

  it("returns the billable attempt key so charge paths reuse it (no double billing)", async () => {
    const res = await generateText("hello", {
      task: "chat",
      category: "auto",
      metering: { userId: USER_UUID, feature: "chat-unified" },
    });

    expect(res.metering.requestId).toBeTruthy();
    expect(res.metering.billableIdempotencyKey).toMatch(
      new RegExp(`^metering:llm:${res.metering.requestId}:\\d+$`),
    );

    await vi.waitFor(() => {
      expect(writes.filter((w) => w.table === "cost_events").length).toBeGreaterThanOrEqual(2);
    });
    const usageWrites = writes.filter((w) => w.table === "usage_events");
    const keys = usageWrites.map((w) => w.row.idempotency_key as string);
    expect(keys).toContain(res.metering.billableIdempotencyKey);
  });
});
