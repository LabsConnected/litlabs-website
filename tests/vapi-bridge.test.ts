// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies before importing
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => ({ data: null })),
            single: vi.fn(() => ({ data: null, error: null })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })) })),
    })),
  },
}));

vi.mock("@/lib/vapi-tools", () => ({
  authorizeVapiRequest: vi.fn((authHeader: string) => {
    return authHeader === "Bearer valid-token-0123456789-abcdef";
  }),
  authDiagnostic: vi.fn(() => ({
    authHeaderPresent: true,
    bearerPrefixPresent: true,
    credentialMatched: false,
    expectedTokenConfigured: true,
  })),
  ownerClerkId: vi.fn(() => "user_owner123"),
}));

vi.mock("@/lib/voice/voice-session-service", () => ({
  startVoiceSession: vi.fn(async (params: { provider: string; providerCallId: string; callerPhone: string }) => ({
    id: "session-1",
    provider: params.provider,
    providerCallId: params.providerCallId,
    userId: "user_abc",
    conversationId: "conv-123",
    projectId: "proj-xyz",
    callerPhone: params.callerPhone,
    callerName: "Larry",
    status: "active" as const,
    startedAt: new Date().toISOString(),
    endedAt: null,
    metadata: null,
  })),
  endVoiceSession: vi.fn(async () => true),
  getVoiceSession: vi.fn(async () => null),
  normalizePhone: vi.fn((phone: string) => phone.replace(/[^0-9+]/g, "")),
}));

vi.mock("@/lib/voice/voice-runtime", () => ({
  runLiTTForVoice: vi.fn(async (args: { userId: string | null; message: string }) => ({
    status: 200,
    body: {
      text: args.userId
        ? `Hello! Your project is looking good.`
        : "I don't have this phone number linked to a LiTT account yet.",
      provider: "gemini",
      model: "gemini-2.0-flash",
      latencyMs: 500,
    },
  })),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  insertMessage: vi.fn(async () => ({ message: null, duplicate: false })),
}));

// Import after mocks
const { POST: eventsPOST } = await import("@/app/api/vapi/events/route");
const { POST: turnPOST } = await import("@/app/api/vapi/turn/route");
const { startVoiceSession, endVoiceSession, getVoiceSession } = await import("@/lib/voice/voice-session-service");
const { runLiTTForVoice } = await import("@/lib/voice/voice-runtime");

const TOKEN = "valid-token-0123456789-abcdef";

function makeRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// ─── /api/vapi/events ───────────────────────────────────────────

describe("POST /api/vapi/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthorized requests", async () => {
    const req = makeRequest(
      "https://litlabs.net/api/vapi/events",
      { type: "status-update", call: { id: "c1", status: "ringing" } },
      { Authorization: "Bearer wrong" },
    );
    const res = await eventsPOST(req);
    expect(res.status).toBe(401);
  });

  it("creates a voice session on call ringing", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/events", {
      type: "status-update",
      call: { id: "call_123", status: "ringing", customer: { number: "+1234567890" } },
      timestamp: new Date().toISOString(),
    });
    const res = await eventsPOST(req);
    expect(res.status).toBe(200);
    expect(startVoiceSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "vapi",
        providerCallId: "call_123",
        callerPhone: "+1234567890",
      }),
    );
  });

  it("ends the voice session on call ended", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/events", {
      type: "status-update",
      call: { id: "call_456", status: "ended" },
      timestamp: new Date().toISOString(),
    });
    const res = await eventsPOST(req);
    expect(res.status).toBe(200);
    expect(endVoiceSession).toHaveBeenCalledWith("vapi", "call_456", expect.any(Object));
  });

  it("ends the voice session on end-of-call-report", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/events", {
      type: "end-of-call-report",
      call: { id: "call_789" },
      artifact: { durationMs: 60000 },
      timestamp: new Date().toISOString(),
    });
    const res = await eventsPOST(req);
    expect(res.status).toBe(200);
    expect(endVoiceSession).toHaveBeenCalledWith("vapi", "call_789", expect.any(Object));
  });

  it("handles assistant-request with caller resolution", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/events", {
      type: "assistant-request",
      call: { id: "call_a1", customer: { number: "+1234567890" } },
      timestamp: new Date().toISOString(),
    });
    const res = await eventsPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session).toBeDefined();
    expect(json.session.userId).toBe("user_abc");
    expect(json.contextBlock).toContain("phone call");
  });

  it("rejects missing call ID", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/events", {
      type: "assistant-request",
      call: { customer: { number: "+1234567890" } },
    });
    const res = await eventsPOST(req);
    expect(res.status).toBe(400);
  });

  it("accepts unhandled event types gracefully", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/events", {
      type: "some-future-event",
      call: { id: "c1" },
    });
    const res = await eventsPOST(req);
    expect(res.status).toBe(200);
  });
});

// ─── /api/vapi/turn ─────────────────────────────────────────────

describe("POST /api/vapi/turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthorized requests", async () => {
    const req = makeRequest(
      "https://litlabs.net/api/vapi/turn",
      { call: { id: "c1" }, messages: [{ role: "user", content: "hi" }] },
      { Authorization: "Bearer wrong" },
    );
    const res = await turnPOST(req);
    expect(res.status).toBe(401);
  });

  it("rejects missing call ID", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/turn", {
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await turnPOST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing user message", async () => {
    const req = makeRequest("https://litlabs.net/api/vapi/turn", {
      call: { id: "c1" },
      messages: [{ role: "system", content: "hi" }],
    });
    const res = await turnPOST(req);
    expect(res.status).toBe(400);
  });

  it("returns fallback when no voice session exists", async () => {
    vi.mocked(getVoiceSession).mockResolvedValueOnce(null);
    const req = makeRequest("https://litlabs.net/api/vapi/turn", {
      call: { id: "no_session_call" },
      messages: [{ role: "user", content: "hello" }],
    });
    const res = await turnPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toContain("couldn't find your session");
  });

  it("routes through runLiTTForVoice and returns OpenAI-compatible format", async () => {
    vi.mocked(getVoiceSession).mockResolvedValueOnce({
      id: "session-1",
      provider: "vapi",
      providerCallId: "call_turn_1",
      userId: "user_abc",
      conversationId: "conv-123",
      projectId: "proj-xyz",
      callerPhone: "+1234567890",
      callerName: "Larry",
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      metadata: null,
    });
    const req = makeRequest("https://litlabs.net/api/vapi/turn", {
      call: { id: "call_turn_1" },
      messages: [
        { role: "system", content: "You are LiTT" },
        { role: "user", content: "How's my project looking?" },
      ],
    });
    const res = await turnPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.choices).toBeDefined();
    expect(json.choices[0].message.role).toBe("assistant");
    expect(json.choices[0].message.content).toContain("looking good");
    expect(json.text).toContain("looking good");
    expect(runLiTTForVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_abc",
        projectId: "proj-xyz",
        conversationId: "conv-123",
        message: "How's my project looking?",
      }),
    );
  });

  it("returns fallback text when runLiTTForVoice returns non-200", async () => {
    vi.mocked(getVoiceSession).mockResolvedValueOnce({
      id: "session-2",
      provider: "vapi",
      providerCallId: "call_turn_2",
      userId: "user_abc",
      conversationId: null,
      projectId: null,
      callerPhone: "+1234567890",
      callerName: null,
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      metadata: null,
    });
    vi.mocked(runLiTTForVoice).mockResolvedValueOnce({
      status: 500,
      body: { text: "", provider: "", model: "", latencyMs: 0 },
    });
    const req = makeRequest("https://litlabs.net/api/vapi/turn", {
      call: { id: "call_turn_2" },
      messages: [{ role: "user", content: "test" }],
    });
    const res = await turnPOST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.text).toContain("error");
  });
});
