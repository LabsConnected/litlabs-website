// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), authorize: vi.fn(), charge: vi.fn(), emit: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/metered-llm-call", () => ({ assertSpendAuthorized: mocks.authorize }));
vi.mock("@/lib/llm-billing", () => ({ chargeLlmUsage: mocks.charge }));
vi.mock("@/lib/metering", () => ({ emitLlmMetering: mocks.emit }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: mocks.generate }; } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "test-placeholder");
  mocks.auth.mockResolvedValue({ userId: "user-test", clerkId: "user-test" });
  mocks.authorize.mockResolvedValue({ ok: true, billingExempt: false });
  mocks.charge.mockResolvedValue({ debited: true });
  mocks.generate.mockResolvedValue({ text: JSON.stringify({ ideas: [{ title: "Scene", prompt: "Move" }] }),
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 } });
});
const routes = [
  { name: "analyze-image", load: () => import("./analyze-image/route"), body: { imageBytes: "dGVzdA==" } },
  { name: "analyze-video", load: () => import("./analyze-video/route"), body: { videoBytes: "dGVzdA==" } },
  { name: "suggest-video-ideas", load: () => import("./suggest-video-ideas/route"), body: { imageBytes: "dGVzdA==" } },
];
describe.each(routes)("$name billing gate", ({ name, load, body }) => {
  async function request() {
    const route = await load();
    return route.POST(new NextRequest(`https://example.test/api/media/${name}`, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
    }));
  }
  it("rejects unauthenticated requests before provider spend", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await request()).status).toBe(401);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects an unfunded account before provider spend", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 402, error: "Insufficient LiTTBits" });
    expect((await request()).status).toBe(402);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.charge).not.toHaveBeenCalled();
  });
  it("preserves provider output and emits one linked charge", async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
    const event = mocks.emit.mock.calls[0][0];
    expect(mocks.charge.mock.calls[0][0].meteringBillableKey).toBe(event.idempotencyKey);
  });
  it("records provider failures without a user debit", async () => {
    mocks.generate.mockRejectedValue(new Error("provider unavailable"));
    expect((await request()).status).toBe(500);
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", billable: false }));
    expect(mocks.charge).not.toHaveBeenCalled();
  });
});
