import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/* ── Mocks ─────────────────────────────────────────────────────────── */

const generateJSONMock = vi.fn();
vi.mock("@/lib/llm", () => ({
  generateJSON: (...args: unknown[]) => generateJSONMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_123", clerkId: "clerk_123" })),
}));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/music/enhance-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/music/enhance-prompt metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateJSONMock.mockResolvedValue({
      original: "a sad song",
      enhanced: "a sad song with strings",
      genre: "indie",
      subgenre: "folk",
      tempo: "80",
      key: "A minor",
      drums: "soft brushes",
      bass: "upright",
      instrumentation: "guitar, strings",
      vocalCharacter: "breathy",
      hookDirection: "singalong",
      arrangement: "sparse",
      productionTexture: "warm",
      energyCurve: "builds",
    });
  });

  it("threads metering context into generateJSON so llm.ts emits per-attempt events", async () => {
    const { POST } = await import("./route");
    const res = await POST(postRequest({ prompt: "a sad song" }));

    expect(res.status).toBe(200);
    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    const options = generateJSONMock.mock.calls[0][1] as Record<string, unknown>;
    expect(options.metering).toMatchObject({
      clerkId: "clerk_123",
      feature: "music-enhance",
    });
  });
});
