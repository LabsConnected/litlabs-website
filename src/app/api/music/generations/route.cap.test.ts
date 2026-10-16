// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { limitMock, createGeneration, releaseMock } = vi.hoisted(() => ({
  limitMock: vi.fn(async (_input?: unknown): Promise<{
    status: number;
    code: string;
    reason: string;
    error: string;
  } | null> => null),
  releaseMock: vi.fn(async (_input?: unknown) => undefined),
  createGeneration: vi.fn(async (_input?: unknown) => ({
    generationId: "gen-1",
    status: "queued",
    lbcCharged: 3,
    replayed: false,
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_123" })),
}));
vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: (req: Request) => Promise<Response>) => handler,
}));
vi.mock("@/lib/user-db", () => ({
  getUserByClerkId: vi.fn(async () => ({ id: "db-user" })),
}));
vi.mock("@/lib/music/generation-service", () => ({
  createGeneration: (input: unknown) => createGeneration(input),
  processPendingGenerations: vi.fn(async () => undefined),
}));
vi.mock("@/lib/music/providers/factory", () => ({
  getConfiguredProviderName: vi.fn(() => "elevenlabs"),
  isMockAllowed: vi.fn(() => false),
  getProviderHealth: vi.fn(() => ({ healthy: true })),
}));
vi.mock("@/lib/owner", () => ({
  isBillingExempt: vi.fn(() => false),
  getActiveSimulation: vi.fn(async () => null),
}));
vi.mock("@/lib/generation/enforce-media-caps", async () => {
  const actual = await vi.importActual<typeof import("@/lib/generation/enforce-media-caps")>(
    "@/lib/generation/enforce-media-caps",
  );
  return {
    ...actual,
    assertGenerationWithinPlanCaps: (input: unknown) => limitMock(input),
    releaseMediaCapHold: (input: unknown) => releaseMock(input),
  };
});

import { POST } from "./route";

function request() {
  return new Request("https://www.litlabs.net/api/music/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "a quiet piano loop",
      idempotencyKey: "music-key-1",
      duration: "concept",
    }),
  });
}

beforeEach(() => {
  limitMock.mockReset();
  limitMock.mockResolvedValue(null);
  createGeneration.mockClear();
  releaseMock.mockClear();
});

describe("POST /api/music/generations plan cap", () => {
  it("checks the elevenlabs music model before creating a generation", async () => {
    const res = await POST(request() as never);
    expect(res.status).toBe(202);
    expect(limitMock).toHaveBeenCalledWith(expect.objectContaining({
      clerkId: "user_123",
      requestId: "music-key-1",
      modality: "music",
      provider: "elevenlabs",
      model: "music_v2",
    }));
    expect(createGeneration).toHaveBeenCalledTimes(1);
  });

  it("returns plan_limit and does not create a generation when the spend cap is exhausted", async () => {
    limitMock.mockResolvedValue({
      status: 402,
      code: "plan_limit",
      reason: "provider_spend_cap",
      error: "Provider spend cap is reached.",
    });
    const res = await POST(request() as never);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("plan_limit");
    expect(body.reason).toBe("provider_spend_cap");
    expect(createGeneration).not.toHaveBeenCalled();
  });
});
