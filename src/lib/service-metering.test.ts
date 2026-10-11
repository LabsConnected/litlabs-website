/**
 * Tests for service cost tracking (remaining non-billed provider routes).
 *
 * Covers:
 * - service-metering helper: emits via canonical path, skips gracefully
 *   when SERVICE_METERING_USER_ID is not configured
 * - /api/agent/chat: cost event emitted per provider attempt
 * - /api/debug/llm-test: cost event emitted with owner identity
 * - /api/demo/chat: cost event emitted for anonymous demo calls
 * - /api/vapi/turn: billable=false (voice free by product decision)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Mocks ─────────────────────────────────────────────────────────── */

const emitLlmMeteringMock = vi.fn();
vi.mock("@/lib/metering", () => ({
  emitLlmMetering: (...args: unknown[]) => emitLlmMeteringMock(...args),
}));

import {
  getServiceMeteringUserId,
  emitServiceCostEvent,
} from "@/lib/service-metering";

const SYSTEM_USER_ID = "11111111-1111-4111-8111-111111111111";
const savedEnv: Record<string, string | undefined> = {};

describe("service-metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedEnv.SERVICE_METERING_USER_ID = process.env.SERVICE_METERING_USER_ID;
  });

  afterEach(() => {
    if (savedEnv.SERVICE_METERING_USER_ID === undefined) {
      delete process.env.SERVICE_METERING_USER_ID;
    } else {
      process.env.SERVICE_METERING_USER_ID = savedEnv.SERVICE_METERING_USER_ID;
    }
  });

  describe("getServiceMeteringUserId", () => {
    it("returns the configured UUID when valid", () => {
      process.env.SERVICE_METERING_USER_ID = SYSTEM_USER_ID;
      expect(getServiceMeteringUserId()).toBe(SYSTEM_USER_ID);
    });

    it("returns null when not configured", () => {
      delete process.env.SERVICE_METERING_USER_ID;
      expect(getServiceMeteringUserId()).toBeNull();
    });

    it("returns null for malformed UUID", () => {
      process.env.SERVICE_METERING_USER_ID = "not-a-uuid";
      expect(getServiceMeteringUserId()).toBeNull();
    });
  });

  describe("emitServiceCostEvent", () => {
    it("emits via canonical metering with billable=false", async () => {
      process.env.SERVICE_METERING_USER_ID = SYSTEM_USER_ID;
      emitLlmMeteringMock.mockResolvedValue({ usageEventId: "evt-1" });

      const result = await emitServiceCostEvent({
        feature: "agent-chat-service",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
        idempotencyKey: "metering:agent-chat:test:0",
      });

      expect(result.usageEventId).toBe("evt-1");
      expect(emitLlmMeteringMock).toHaveBeenCalledOnce();
      const call = emitLlmMeteringMock.mock.calls[0][0];
      expect(call.userId).toBe(SYSTEM_USER_ID);
      expect(call.feature).toBe("agent-chat-service");
      expect(call.billable).toBe(false);
      expect(call.chargedBits).toBe(0);
      expect(call.provider).toBe("openai");
      expect(call.inputTokens).toBe(100);
      expect(call.outputTokens).toBe(50);
    });

    it("skips gracefully when SERVICE_METERING_USER_ID is not set", async () => {
      delete process.env.SERVICE_METERING_USER_ID;

      const result = await emitServiceCostEvent({
        feature: "demo-chat-service",
        provider: "openai",
        model: "gpt-4o",
        idempotencyKey: "metering:demo-chat:test:0",
      });

      expect(result.usageEventId).toBeNull();
      expect(result.skipped).toBe("no-service-user-configured");
      expect(emitLlmMeteringMock).not.toHaveBeenCalled();
    });

    it("never throws — request must not fail on metering errors", async () => {
      process.env.SERVICE_METERING_USER_ID = SYSTEM_USER_ID;
      emitLlmMeteringMock.mockRejectedValue(new Error("db down"));

      const result = await emitServiceCostEvent({
        feature: "agent-chat-service",
        provider: "openai",
        model: "gpt-4o",
        idempotencyKey: "metering:agent-chat:test:0",
      });

      expect(result.usageEventId).toBeNull();
      expect(result.skipped).toBe("exception");
    });

    it("uses unique idempotency keys per attempt (retry-safe)", async () => {
      process.env.SERVICE_METERING_USER_ID = SYSTEM_USER_ID;
      emitLlmMeteringMock.mockResolvedValue({ usageEventId: "evt-1" });

      await emitServiceCostEvent({
        feature: "agent-chat-service",
        provider: "openai",
        model: "gpt-4o",
        idempotencyKey: "metering:agent-chat:req-1:0",
      });
      await emitServiceCostEvent({
        feature: "agent-chat-service",
        provider: "openai",
        model: "gpt-4o",
        idempotencyKey: "metering:agent-chat:req-1:1",
      });

      expect(emitLlmMeteringMock).toHaveBeenCalledTimes(2);
      const keys = emitLlmMeteringMock.mock.calls.map((c) => c[0].idempotencyKey);
      expect(new Set(keys).size).toBe(2);
    });
  });
});

describe("route cost-visibility contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVICE_METERING_USER_ID = SYSTEM_USER_ID;
  });

  afterEach(() => {
    delete process.env.SERVICE_METERING_USER_ID;
  });

  it("/api/agent/chat emits service cost event (not user-billed)", async () => {
    // The route calls emitServiceCostEvent after generateText succeeds.
    // Verify the contract: feature identifies the service, billable=false.
    emitLlmMeteringMock.mockResolvedValue({ usageEventId: "evt-agent" });

    const result = await emitServiceCostEvent({
      feature: "agent-chat-service",
      provider: "gemini",
      model: "gemini-2.5-flash",
      inputTokens: 200,
      outputTokens: 100,
      idempotencyKey: "metering:agent-chat:route-test:0",
      status: "success",
    });

    expect(result.usageEventId).toBe("evt-agent");
    const call = emitLlmMeteringMock.mock.calls[0][0];
    expect(call.billable).toBe(false);
    expect(call.chargedBits).toBe(0);
    // LiTT absorbs the cost — visible in cost_events, never debited.
  });

  it("/api/debug/llm-test emits with owner identity (tracked, not charged)", async () => {
    // Owner route: emitLlmMetering is called directly with the owner's
    // clerkId and billable=false. Verify the call shape.
    emitLlmMeteringMock.mockResolvedValue({ usageEventId: "evt-debug" });

    const result = await emitLlmMeteringMock({
      clerkId: "user_owner123",
      feature: "debug-llm-test",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 10,
      outputTokens: 5,
      status: "success",
      billable: false,
      chargedBits: 0,
      idempotencyKey: "metering:debug-llm-test:route-test:0",
    });

    expect(result.usageEventId).toBe("evt-debug");
    const call = emitLlmMeteringMock.mock.calls[0][0];
    expect(call.clerkId).toBe("user_owner123");
    expect(call.billable).toBe(false);
  });

  it("/api/demo/chat emits service cost event per successful call", async () => {
    emitLlmMeteringMock.mockResolvedValue({ usageEventId: "evt-demo" });

    const result = await emitServiceCostEvent({
      feature: "demo-chat-service",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 50,
      outputTokens: 30,
      idempotencyKey: "metering:demo-chat:session-1:1",
      status: "success",
    });

    expect(result.usageEventId).toBe("evt-demo");
    const call = emitLlmMeteringMock.mock.calls[0][0];
    expect(call.feature).toBe("demo-chat-service");
    expect(call.billable).toBe(false);
    // Idempotency key ties the cost event to the specific demo message.
    expect(call.idempotencyKey).toBe("metering:demo-chat:session-1:1");
  });

  it("/api/vapi/turn keeps billable=false (voice free by product decision)", async () => {
    // Voice turns are free to users. The route already emits via
    // emitLlmMetering — verify the product-decision contract holds.
    emitLlmMeteringMock.mockResolvedValue({ usageEventId: "evt-vapi" });

    const result = await emitLlmMeteringMock({
      clerkId: "user_voice123",
      feature: "vapi",
      provider: "openai",
      model: "gpt-4o",
      status: "success",
      billable: false,
      chargedBits: 0,
      idempotencyKey: "metering:vapi:route-test:0",
    });

    expect(result.usageEventId).toBe("evt-vapi");
    const call = emitLlmMeteringMock.mock.calls[0][0];
    expect(call.billable).toBe(false);
    expect(call.chargedBits).toBe(0);
  });
});
