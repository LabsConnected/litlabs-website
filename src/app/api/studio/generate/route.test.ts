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

const { limitMock, generateContentMock } = vi.hoisted(() => ({
  limitMock: vi.fn(async (_input?: unknown): Promise<{
    status: number;
    code: string;
    reason: string;
    error: string;
  } | null> => null),
  generateContentMock: vi.fn(),
}));
vi.mock("@/lib/generation/enforce-media-caps", async () => {
  const actual = await vi.importActual<typeof import("@/lib/generation/enforce-media-caps")>(
    "@/lib/generation/enforce-media-caps",
  );
  return {
    ...actual,
    assertGenerationWithinPlanCaps: (input: unknown) => limitMock(input),
  };
});
vi.mock("@/lib/generation/identity", () => ({
  resolveInternalUserId: vi.fn(async () => null),
}));
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
    limitMock.mockResolvedValue(null);
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

  it("returns plan_limit and does not call Gemini when the monthly cap is exhausted", async () => {
    limitMock.mockResolvedValue({
      status: 429,
      code: "plan_limit",
      reason: "monthly_image_cap",
      error: "Creator Beta allows 53 paid images this month.",
    });
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ prompt: "a neon city skyline", provider: "gemini" }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("plan_limit");
    expect(body.reason).toBe("monthly_image_cap");
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("returns plan_limit and does not mint pollinations urls when the free daily cap is exhausted", async () => {
    limitMock.mockResolvedValue({
      status: 429,
      code: "plan_limit",
      reason: "free_model_daily_cap",
      error: "Starter allows 8 free generations per day.",
    });
    const { POST } = await import("./route");
    const res = await POST(
      postRequest({ prompt: "a neon city skyline", provider: "pollinations", batchSize: 2 }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.reason).toBe("free_model_daily_cap");
    expect(limitMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "pollinations",
      model: "flux",
      providerCostCents: 0,
      units: 2,
    }));
  });
});
