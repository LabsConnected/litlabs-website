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
  return new NextRequest("http://localhost:3000/api/media/analyze-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/media/analyze-video metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable success event with provider usage tokens", async () => {
    generateContentMock.mockResolvedValue({
      text: "A person walks across the frame.",
      usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 60 },
    });
    const { POST } = await import("./route");
    const res = await POST(postRequest({ videoBytes: "aGVsbG8=" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("A person walks across the frame.");

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock.mock.calls[0][0].model).toBe("gemini-3.1-pro-preview");

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      status: "success",
      feature: "media-analyze",
      clerkId: "clerk_123",
      inputTokens: 5000,
      outputTokens: 60,
      chargedBits: 0,
    });
    expect(evt.billable).not.toBe(false);
  });

  it("emits a failed, non-billable event when generation throws", async () => {
    generateContentMock.mockRejectedValue(new Error("model overloaded"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ videoBytes: "aGVsbG8=" }));

    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("model overloaded");
  });
});
