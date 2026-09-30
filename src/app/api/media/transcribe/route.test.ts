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

const generateContentMock = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      models: {
        generateContent: (...args: unknown[]) => generateContentMock(...args),
      },
    };
  }),
}));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/media/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/media/transcribe metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable success event with the transcription capability", async () => {
    generateContentMock.mockResolvedValue({
      text: "hello world",
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 10 },
    });
    const { POST } = await import("./route");
    const res = await POST(postRequest({ audioBytes: "aGVsbG8=" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("hello world");

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock.mock.calls[0][0].model).toBe("gemini-3.5-flash");

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "transcription",
      provider: "gemini",
      model: "gemini-3.5-flash",
      status: "success",
      feature: "transcription",
      clerkId: "clerk_123",
      inputTokens: 800,
      outputTokens: 10,
      chargedBits: 0,
    });
    // Provider cost comes from the canonical cost engine.
    expect(typeof evt.providerCostMicros).toBe("number");
    // Success → the emitter defaults billable=true (P0: exactly one
    // billable usage_event per logical action).
    expect(evt.billable).not.toBe(false);
    expect(evt.idempotencyKey).toMatch(/^metering:transcription:[0-9a-f-]{36}:0$/);
  });

  it("emits a failed, non-billable event when generation throws", async () => {
    generateContentMock.mockRejectedValue(new Error("audio too long"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ audioBytes: "aGVsbG8=" }));

    expect(res.status).toBe(500);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "transcription",
      provider: "gemini",
      model: "gemini-3.5-flash",
      status: "failed",
      billable: false,
      providerCostMicros: 0,
    });
    expect(evt.error).toContain("audio too long");
  });
});
