// @vitest-environment node
/**
 * Director fallback must refuse provider spend when the wallet cannot
 * cover the estimated cost, and must debit through meteredLlmCall.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authMock, meteredLlmCallMock, getAgentMock, detectIntentMock, detectAndExecuteToolMock, getUserByClerkIdMock, getStudioContextMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  meteredLlmCallMock: vi.fn(),
  getAgentMock: vi.fn(),
  detectIntentMock: vi.fn(),
  detectAndExecuteToolMock: vi.fn(),
  getUserByClerkIdMock: vi.fn(),
  getStudioContextMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/metered-llm-call", () => ({ meteredLlmCall: meteredLlmCallMock }));
vi.mock("@/lib/agents", () => ({
  orchestrator: {
    getAgent: getAgentMock,
    addToMemory: vi.fn(),
    simulateAgentResponse: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/user-db", () => ({ getUserByClerkId: getUserByClerkIdMock }));
vi.mock("supermemory", () => ({ Supermemory: vi.fn() }));
vi.mock("@/lib/capabilities/studio-context", () => ({
  getStudioContext: getStudioContextMock,
  buildCapabilityContextForChat: vi.fn(() => ""),
}));
vi.mock("@/lib/litt-intelligence/tool-executor", () => ({
  detectAndExecuteTool: detectAndExecuteToolMock,
}));
vi.mock("@/lib/litt-intelligence/runtime-context-injector", () => ({
  detectIntent: detectIntentMock,
  buildRuntimeContextBlock: vi.fn(() => ""),
  buildToolManifest: vi.fn(() => ({ manifestBlock: "", tools: [] })),
  generateProjectStatusAnswer: vi.fn(),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/agents/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "clerk_director" });
  detectIntentMock.mockReturnValue({ category: "general", confidence: 0 });
  detectAndExecuteToolMock.mockResolvedValue({ executed: false });
  getUserByClerkIdMock.mockResolvedValue({ name: "Ada" });
  getStudioContextMock.mockResolvedValue(null);
  getAgentMock.mockReturnValue(null);
});

describe("POST /api/agents/chat director fallback billing", () => {
  it("returns 402 and never treats the model text as a reply when underfunded", async () => {
    meteredLlmCallMock.mockResolvedValue({
      ok: false,
      status: 402,
      error: "Insufficient LiTTBits",
      code: "insufficient_credits",
    });

    const res = await POST(request({ message: "plan the landing page" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("insufficient_credits");
    expect(meteredLlmCallMock).toHaveBeenCalledTimes(1);
    expect(meteredLlmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: "clerk_director",
        feature: "agents-chat-fallback",
      }),
    );
  });

  it("debits through meteredLlmCall with a stable request id", async () => {
    meteredLlmCallMock.mockResolvedValue({
      ok: true,
      result: { text: "On it.", provider: "gemini", model: "gemini-2.5-flash", latencyMs: 1 },
      billing: { debited: true },
    });

    const res = await POST(request({
      message: "plan the landing page",
      requestId: "req-stable-01",
    }));
    expect(res.status).toBe(200);
    expect(meteredLlmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: "agents-chat:req-stable-01",
        feature: "agents-chat-fallback",
      }),
    );
  });

  it("returns the debit RPC error and does not reply with model text", async () => {
    meteredLlmCallMock.mockResolvedValue({
      ok: false,
      status: 503,
      error: "debit_credits failed: ledger down",
      code: "billing_unavailable",
    });

    const res = await POST(request({ message: "plan the landing page" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("debit_credits failed: ledger down");
    expect(body.code).toBe("billing_unavailable");
    expect(body.response).toBeUndefined();
  });
});
