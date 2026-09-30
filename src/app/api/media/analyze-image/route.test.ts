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
  return new NextRequest("http://localhost:3000/api/media/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/media/analyze-image metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable success event with provider usage tokens", async () => {
    generateContentMock.mockResolvedValue({
      text: "I see a login form.",
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 30 },
    });
    const { POST } = await import("./route");
    const res = await POST(postRequest({ imageBytes: "aGVsbG8=" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("I see a login form.");

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock.mock.calls[0][0].model).toBe("gemini-3.5-flash");

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "gemini",
      model: "gemini-3.5-flash",
      status: "success",
      feature: "media-analyze",
      clerkId: "clerk_123",
      inputTokens: 1200,
      outputTokens: 30,
      chargedBits: 0,
    });
    expect(evt.billable).not.toBe(false);
    expect(evt.idempotencyKey).toMatch(/^metering:llm:[0-9a-f-]{36}:0$/);
  });

  it("emits a failed, non-billable event when generation throws", async () => {
    generateContentMock.mockRejectedValue(new Error("quota exceeded"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ imageBytes: "aGVsbG8=" }));

    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "gemini",
      model: "gemini-3.5-flash",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("quota exceeded");
  });
});
