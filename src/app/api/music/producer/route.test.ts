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
  return new NextRequest("http://localhost:3000/api/music/producer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/music/producer metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateJSONMock.mockResolvedValue({
      enhancedPrompt: "a harder trap beat",
      styles: ["trap"],
      avoidStyles: ["acoustic"],
      bpm: 140,
      key: "C Minor",
      energy: 9,
      vocalDirection: "aggressive",
      songStructure: ["intro", "verse", "chorus"],
      producerNote: "Push the 808s.",
    });
  });

  it("threads metering context into generateJSON so llm.ts emits per-attempt events", async () => {
    const { POST } = await import("./route");
    const res = await POST(postRequest({ prompt: "make it harder" }));

    expect(res.status).toBe(200);
    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    const options = generateJSONMock.mock.calls[0][1] as Record<string, unknown>;
    expect(options.metering).toMatchObject({
      clerkId: "clerk_123",
      feature: "music-producer",
    });
  });
});
