// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), authorize: vi.fn(), simulate: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/metered-llm-call", () => ({ assertSpendAuthorized: mocks.authorize }));
vi.mock("@/lib/llm", () => ({ generateText: vi.fn(), streamText: vi.fn() }));
vi.mock("@/lib/llm-billing", () => ({ chargeLlmUsage: vi.fn() }));
vi.mock("@/lib/agent-entitlements", () => ({ resolveAgentEntitlement: vi.fn(), chargeAgentRun: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/spend-guards", () => ({ SpendGuardError: class extends Error {} }));
vi.mock("@/lib/agents", () => ({ AGENTS: {}, orchestrator: {
  getAgent: () => ({ id: "agent", name: "Agent" }), sendMessage: mocks.send,
  simulateAgentResponse: mocks.simulate,
} }));
import { POST } from "./route";
import { POST as legacyPOST } from "../route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user-test", clerkId: "user-test" });
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.simulate.mockResolvedValue("Response");
});
describe.each([{ name: "unified", handler: POST }, { name: "legacy", handler: legacyPOST }])("$name agent billing gate", ({ handler }) => {
function request() {
  return handler(new NextRequest("https://example.test/api/chat/unified", { method: "POST",
    body: JSON.stringify({ mode: "agent", from: "a", to: "b", message: "Hello", simulateResponse: true }),
    headers: { "content-type": "application/json" },
  }));
}
it("rejects anonymous agent provider execution", async () => {
  mocks.auth.mockResolvedValue({ userId: null, clerkId: null });
  expect((await request()).status).toBe(401);
  expect(mocks.simulate).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("blocks an unfunded account before creating a paid response", async () => {
  mocks.authorize.mockResolvedValue({ ok: false, status: 402, error: "Insufficient LiTTBits" });
  expect((await request()).status).toBe(402);
  expect(mocks.simulate).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("threads authenticated billing identity into the shared agent runtime", async () => {
  expect((await request()).status).toBe(200);
  expect(mocks.simulate).toHaveBeenCalledWith("b", "Hello", undefined, undefined,
    { clerkId: "user-test", callId: expect.any(String) });
});

});
