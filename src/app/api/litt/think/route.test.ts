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

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_123", clerkId: "clerk_123" })),
}));

const runAIMock = vi.fn();
vi.mock("@/lib/ai/providers", () => ({
  runAI: (...args: unknown[]) => runAIMock(...args),
}));

// The think route pulls in jarvis context + tool executor; keep the
// test focused on metering by stubbing the tool-detection layers.
vi.mock("@/lib/litt-context", () => ({
  buildJarvisPrompt: vi.fn(() => "prompt"),
  collectJarvisContext: vi.fn(() => ({})),
  parseJarvisActions: vi.fn(() => []),
}));

vi.mock("@/lib/litt-intelligence/tool-executor", () => ({
  detectAndExecuteTool: vi.fn(async () => ({ executed: false })),
  detectToolIntent: vi.fn(() => false),
}));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/litt/think", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = { message: "why is my build failing?", context: { route: "/litt" } };

describe("POST /api/litt/think metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits one billable event when the primary (ollama) attempt succeeds", async () => {
    runAIMock.mockResolvedValueOnce("Check your logs.");
    const { POST } = await import("./route");
    const res = await POST(postRequest(BODY));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toBe("Check your logs.");

    expect(runAIMock).toHaveBeenCalledTimes(1);
    expect(runAIMock.mock.calls[0][0]).toMatchObject({ provider: "ollama" });

    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(1);
    const [evt] = emitLlmMeteringMock.mock.calls[0] as [Record<string, unknown>];
    expect(evt).toMatchObject({
      feature: "litt-think",
      provider: "ollama",
      model: "llama3.2:3b",
      status: "success",
      billable: true,
      clerkId: "clerk_123",
      retrySequence: 0,
    });
    expect(evt.originalRequestId).toBeTruthy();
    expect(evt.idempotencyKey).toBe(`metering:litt-think:${evt.originalRequestId}:0`);
  });

  it("emits failed-then-success with retry linkage when ollama fails over to openrouter", async () => {
    runAIMock
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockResolvedValueOnce("Fallback answer.");
    const { POST } = await import("./route");
    const res = await POST(postRequest(BODY));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toBe("Fallback answer.");

    // Two attempts, two usage events — but exactly ONE is billable.
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(2);
    const [first, second] = emitLlmMeteringMock.mock.calls.map((c) => c[0]) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    expect(first).toMatchObject({
      feature: "litt-think",
      provider: "ollama",
      model: "llama3.2:3b",
      status: "failed",
      billable: false,
      retrySequence: 0,
    });
    expect(first.error).toContain("ollama down");

    expect(second).toMatchObject({
      feature: "litt-think",
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      status: "success",
      billable: true,
      retrySequence: 1,
    });

    // Both attempts tie to the same logical action.
    expect(second.originalRequestId).toBe(first.originalRequestId);
    expect(second.idempotencyKey).toBe(
      `metering:litt-think:${first.originalRequestId}:1`,
    );
  });

  it("emits two non-billable failed events when both attempts fail", async () => {
    runAIMock
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockRejectedValueOnce(new Error("openrouter down"));
    const { POST } = await import("./route");
    const res = await POST(postRequest(BODY));

    expect(res.status).toBe(500);
    expect(emitLlmMeteringMock).toHaveBeenCalledTimes(2);
    const [first, second] = emitLlmMeteringMock.mock.calls.map((c) => c[0]) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(first).toMatchObject({ status: "failed", billable: false, retrySequence: 0 });
    expect(second).toMatchObject({ status: "failed", billable: false, retrySequence: 1 });
    expect(second.originalRequestId).toBe(first.originalRequestId);
  });
});
