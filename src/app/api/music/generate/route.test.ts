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
  return new NextRequest("http://localhost:3000/api/music/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/music/generate metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MINIMAX_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits a billable music event on a successful generation", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          base_resp: { status_code: 0, status_msg: "success" },
          data: { status: "processing" },
          trace_id: "trace-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { POST } = await import("./route");
    const res = await POST(postRequest({ prompt: "a lo-fi beat" }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "music",
      provider: "minimax",
      model: "music-2.6-free",
      status: "success",
      feature: "music-gen",
      clerkId: "clerk_123",
      providerCostMicros: 0,
      chargedBits: 0,
    });
    expect(evt.billable).not.toBe(false);
    expect(evt.idempotencyKey).toMatch(/^metering:music:[0-9a-f-]{36}:0$/);
  });

  it("emits a failed, non-billable event when MiniMax rejects the request", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          base_resp: { status_code: 1004, status_msg: "auth failed" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { POST } = await import("./route");
    const res = await POST(postRequest({ prompt: "a lo-fi beat" }));

    expect(res.status).toBe(502);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      capability: "music",
      provider: "minimax",
      status: "failed",
      billable: false,
    });
    expect(evt.error).toContain("1004");
  });

  it("emits a failed event when the fetch itself throws", async () => {
    fetchMock.mockRejectedValue(new Error("connection reset"));
    const { POST } = await import("./route");
    const res = await POST(postRequest({ prompt: "a lo-fi beat" }));

    expect(res.status).toBe(500);
    expect(emitUsageEventMock).toHaveBeenCalledTimes(1);
    const [evt] = emitUsageEventMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({ status: "failed", billable: false });
    expect(evt.error).toContain("connection reset");
  });
});
