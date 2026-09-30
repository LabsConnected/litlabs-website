import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/* ── Mocks ─────────────────────────────────────────────────────────── */

const emitUsageEventMock = vi.fn(
  async (input: Record<string, unknown>): Promise<{ usageEventId: string }> => ({
    usageEventId: "evt-1",
  }),
);
vi.mock("@/lib/metering", () => ({
  emitUsageEvent: (input: Record<string, unknown>) => emitUsageEventMock(input),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_123", clerkId: "clerk_123" })),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/voice/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/voice/tts metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits one billable success event on a successful TTS call", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    const { POST } = await import("./route");
    const res = await POST(postRequest({ text: "Hello world" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.audioUrl).toMatch(/^data:audio\/mp3;base64,/);

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "speech",
      provider: "openai",
      model: "tts-1",
      status: "success",
      feature: "tts",
      clerkId: "clerk_123",
      chargedBits: 0,
    });
    // OpenAI tts-1 published pricing: $15/1M chars → 15 micros/char.
    expect(evt.providerCostMicros).toBe(11 * 15);
    expect(evt.audioSeconds).toBeGreaterThan(0);
    expect(evt.idempotencyKey).toMatch(/^metering:tts:[0-9a-f-]{36}:0$/);
    expect(evt.startedAt).toBeInstanceOf(Date);
    expect(evt.finishedAt).toBeInstanceOf(Date);
    // Success → the emitter defaults billable=true; the route must not
    // override it to false (P0: exactly one billable usage_event).
    expect(evt.billable).not.toBe(false);
  });

  it("emits a failed, non-billable event when OpenAI returns an error", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ text: "Hello world" }));

    expect(res.status).toBe(400);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "speech",
      provider: "openai",
      model: "tts-1",
      status: "failed",
      billable: false,
      providerCostMicros: 0,
    });
    expect(evt.error).toContain("400");
    expect(evt.idempotencyKey).toMatch(/^metering:tts:[0-9a-f-]{36}:0$/);
  });

  it("emits a failed, non-billable event when the fetch itself throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ text: "Hello world" }));

    expect(res.status).toBe(500);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      status: "failed",
      billable: false,
      providerCostMicros: 0,
    });
    expect(evt.error).toContain("network down");
  });
});
