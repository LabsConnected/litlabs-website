import { describe, it, expect, vi, beforeEach } from "vitest";
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

vi.mock("@/lib/vapi-tools", () => ({
  authorizeVapiRequest: vi.fn(() => true),
}));

vi.mock("@/lib/rate-limiter", () => ({
  rateLimit: vi.fn(async () => ({ success: true, remaining: 59, resetTime: 60 })),
}));

vi.mock("@/lib/voice/voice-session-service", () => ({
  getVoiceSession: vi.fn(async () => ({
    userId: "clerk_vapi_user",
    projectId: "11111111-2222-3333-4444-555555555555",
    conversationId: "conv-1",
  })),
  startVoiceSession: vi.fn(),
}));

const runLiTTForVoiceMock = vi.fn();
vi.mock("@/lib/voice/voice-runtime", () => ({
  runLiTTForVoice: (...args: unknown[]) => runLiTTForVoiceMock(...args),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  insertMessage: vi.fn(async () => ({})),
}));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/vapi/turn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

const TURN_BODY = {
  call: { id: "call-1", customer: { number: "+1234567890" } },
  messages: [
    { role: "system", content: "You are LiTT." },
    { role: "user", content: "Hello?" },
  ],
};

describe("POST /api/vapi/turn metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits one billable event per voice turn on success", async () => {
    runLiTTForVoiceMock.mockResolvedValue({
      status: 200,
      body: { text: "Hi there!", provider: "gemini", model: "gemini-2.5-flash" },
    });
    const { POST } = await import("./route");
    const res = await POST(postRequest(TURN_BODY));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.text).toBe("Hi there!");

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      feature: "vapi",
      provider: "gemini",
      model: "gemini-2.5-flash",
      status: "success",
      billable: true,
      clerkId: "clerk_vapi_user",
      chargedBits: 0,
    });
    expect(evt.idempotencyKey).toMatch(/^metering:vapi:[0-9a-f-]{36}:0$/);
  });

  it("emits a non-billable failed event when the runtime fails", async () => {
    runLiTTForVoiceMock.mockResolvedValue({
      status: 500,
      body: { text: "", provider: "gemini", model: "gemini-2.5-flash" },
    });
    const { POST } = await import("./route");
    const res = await POST(postRequest(TURN_BODY));

    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      feature: "vapi",
      status: "failed",
      billable: false,
    });
  });

  it("emits a non-billable failed event when the runtime throws", async () => {
    runLiTTForVoiceMock.mockRejectedValue(new Error("runtime exploded"));
    const { POST } = await import("./route");
    const res = await POST(postRequest(TURN_BODY));

    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      feature: "vapi",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("runtime exploded");
  });
});
