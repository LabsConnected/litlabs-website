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
  return new NextRequest("http://localhost:3000/api/media/suggest-video-ideas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const IDEAS_JSON = JSON.stringify({
  ideas: [
    { title: "Golden Hour Drift", prompt: "A slow cinematic pan.", motion: "Slow Pan", vibe: "Dreamy" },
    { title: "Neon Rain", prompt: "Rain falls over neon signs.", motion: "Zoom In", vibe: "Noir" },
  ],
});

describe("POST /api/media/suggest-video-ideas metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable success event when ideas are generated", async () => {
    generateContentMock.mockResolvedValue({
      text: IDEAS_JSON,
      usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 400 },
    });
    const { POST } = await import("./route");
    const res = await POST(postRequest({ imageBytes: "aGVsbG8=" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ideas).toHaveLength(2);

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      status: "success",
      feature: "media-analyze",
      clerkId: "clerk_123",
      inputTokens: 3000,
      outputTokens: 400,
      chargedBits: 0,
    });
    expect(evt.billable).not.toBe(false);
  });

  it("emits a failed, non-billable event when generation throws", async () => {
    generateContentMock.mockRejectedValue(new Error("rate limited"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ imageBytes: "aGVsbG8=" }));

    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("rate limited");
  });
});
