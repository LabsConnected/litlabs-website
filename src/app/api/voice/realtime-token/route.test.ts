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

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/voice/realtime-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/voice/realtime-token metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable success event on token mint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ client_secret: { value: "ek_test_123" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { POST } = await import("./route");
    const res = await POST(postRequest({ instructions: "Be helpful." }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe("ek_test_123");
    expect(data.model).toBe("gpt-4o-realtime-preview-2025-06-03");

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "speech",
      provider: "openai",
      model: "gpt-4o-realtime-preview-2025-06-03",
      status: "success",
      feature: "voice-realtime",
      clerkId: "clerk_123",
      // Token minting is not billed by the provider.
      providerCostMicros: 0,
      chargedBits: 0,
    });
    // Success → the emitter defaults billable=true (P0: exactly one
    // billable usage_event per logical action).
    expect(evt.billable).not.toBe(false);
    expect(evt.idempotencyKey).toMatch(/^metering:voice-realtime:[0-9a-f-]{36}:0$/);
  });

  it("emits a failed, non-billable event when the provider rejects the mint", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ instructions: "Be helpful." }));

    expect(res.status).toBe(502);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      status: "failed",
      billable: false,
      providerCostMicros: 0,
    });
    expect(evt.error).toContain("401");
  });

  it("emits a failed event when no client secret is returned", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { POST } = await import("./route");
    const res = await POST(postRequest({ instructions: "Be helpful." }));

    expect(res.status).toBe(502);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt.status).toBe("failed");
    expect(evt.billable).toBe(false);
  });
});
