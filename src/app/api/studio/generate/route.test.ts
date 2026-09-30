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
  Modality: { IMAGE: "IMAGE" },
}));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/studio/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/studio/generate metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    delete process.env.GEMINI_IMAGE_MODEL;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable image event on a successful Gemini generation", async () => {
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "aW1hZ2U=", mimeType: "image/png" } }],
          },
        },
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ prompt: "a neon city skyline", provider: "gemini" }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.provider).toBe("gemini");
    expect(data.images[0].url).toMatch(/^data:image\/png;base64,/);

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "image",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      status: "success",
      feature: "studio-generate",
      clerkId: "clerk_123",
      imageCount: 1,
      chargedBits: 0,
    });
    expect(evt.billable).not.toBe(false);
    expect(evt.idempotencyKey).toMatch(/^metering:image:[0-9a-f-]{36}:0$/);
  });

  it("emits a failed, non-billable event when the Gemini call throws (and falls back)", async () => {
    generateContentMock.mockRejectedValue(new Error("imagen down"));
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ prompt: "a neon city skyline", provider: "gemini" }),
    );

    // The caller is silently served the pollinations fallback.
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.provider).toBe("pollinations");

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "image",
      provider: "gemini",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("imagen down");
  });

  it("emits nothing on the free pollinations path", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ prompt: "a neon city skyline", provider: "pollinations" }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.free).toBe(true);
    expect(emitUsageEventMock).not.toHaveBeenCalled();
  });
});
