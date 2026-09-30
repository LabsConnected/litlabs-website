import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/* ── Mocks ─────────────────────────────────────────────────────────── */

const emitLlmMeteringMock = vi.fn(
  async (input: Record<string, unknown>): Promise<{ usageEventId: string }> => ({
    usageEventId: "evt-1",
  }),
);
vi.mock("@/lib/metering", () => ({
  emitLlmMetering: (input: Record<string, unknown>) => emitLlmMeteringMock(input),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_123", clerkId: "clerk_123" })),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/voice/speak-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/voice/speak-summary metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable success event with provider usage tokens", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "LiTT built your site." } }],
          usage: { prompt_tokens: 42, completion_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { POST } = await import("./route");
    const res = await POST(postRequest({ text: "A long chat reply here." }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.spoken).toBe("LiTT built your site.");
    expect(data.fallback).toBeUndefined();

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      status: "success",
      feature: "tts",
      clerkId: "clerk_123",
      inputTokens: 42,
      outputTokens: 8,
      chargedBits: 0,
    });
    expect(evt.billable).not.toBe(false);
    expect(evt.idempotencyKey).toMatch(/^metering:llm:[0-9a-f-]{36}:0$/);
  });

  it("still returns 200 with a fallback but meters a failed attempt when the provider errors", async () => {
    fetchMock.mockResolvedValue(new Response("bad", { status: 500 }));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ text: "A long chat reply here." }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fallback).toBe(true);
    expect(typeof data.spoken).toBe("string");

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("500");
  });

  it("meters a failed attempt when the fetch itself throws", async () => {
    fetchMock.mockRejectedValue(new Error("socket hangup"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ text: "A long chat reply here." }));

    // The route's outer catch returns 500 in this path.
    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({ status: "failed", billable: false });
    expect(evt.error).toContain("socket hangup");
  });
});
