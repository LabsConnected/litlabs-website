import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { executeAgentChat } from "./agent-chat-execution";

// Entitled agent: entitlement passes, so the tests below exercise what
// happens after the gate. The spend/charge/LLM mocks are hoisted so a
// test can prove the free dispatch path never touches them, and can
// vary the model result on the simulated path.
const state = vi.hoisted(() => ({
  charge: vi.fn(async () => ({ error: null as string | null })),
  spend: vi.fn(async () => ({ ok: true })),
  metered: vi.fn(async () => ({ ok: true, result: { text: "simulated reply" } })),
}));

vi.mock("@/lib/agent-entitlements", () => ({
  resolveAgentEntitlement: vi.fn(async () => ({ allowed: true })),
  chargeAgentRun: state.charge,
}));

vi.mock("@/lib/metered-llm-call", () => ({
  assertSpendAuthorized: state.spend,
  meteredLlmCall: state.metered,
}));

vi.mock("@/lib/agents", () => ({
  orchestrator: {
    getAgent: vi.fn(() => ({
      systemPrompt: "You are a test agent.",
      personality: "helpful",
      role: "tester",
      name: "Test Agent",
    })),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.charge.mockResolvedValue({ error: null });
  state.spend.mockResolvedValue({ ok: true });
  state.metered.mockResolvedValue({ ok: true, result: { text: "simulated reply" } });
});

describe("executeAgentChat", () => {
  it("resolves to a dispatch outcome — no spend, charge, or model call — for a non-simulated entitled call", async () => {
    const result = await executeAgentChat({
      clerkId: "user_test",
      agentSlug: "litt",
      message: "hello",
      simulateResponse: false,
    });

    expect(result).toEqual({ kind: "dispatch" });
    expect(state.spend).not.toHaveBeenCalled();
    expect(state.charge).not.toHaveBeenCalled();
    expect(state.metered).not.toHaveBeenCalled();
  });

  it("resolves to the reply text on the simulated path", async () => {
    const result = await executeAgentChat({
      clerkId: "user_test",
      agentSlug: "litt",
      message: "hello",
      simulateResponse: true,
    });

    expect(result).toEqual({ kind: "reply", text: "simulated reply" });
  });

  it.each(["", "   \n\t "])("returns a 502 empty_model_reply when the model answers with %j", async (text) => {
    state.metered.mockResolvedValue({ ok: true, result: { text } });

    const result = await executeAgentChat({
      clerkId: "user_test",
      agentSlug: "litt",
      message: "hello",
      simulateResponse: true,
    });

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/empty reply/i);
    expect(body.code).toBe("empty_model_reply");
  });
});
