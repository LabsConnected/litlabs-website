import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_test" })),
}));

const mocks = vi.hoisted(() => ({
  getUserContext: vi.fn(),
  executePlacesLookup: vi.fn(),
  executeWebSearch: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/user-context", () => ({
  getUserContext: (...args: unknown[]) => mocks.getUserContext(...args),
}));

vi.mock("@/lib/litt-intelligence/places-tool", () => ({
  executePlacesLookup: (...args: unknown[]) => mocks.executePlacesLookup(...args),
}));

vi.mock("@/lib/litt-intelligence/web-search-tool", () => ({
  executeWebSearch: (...args: unknown[]) => mocks.executeWebSearch(...args),
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/studio/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserContext.mockResolvedValue({ userId: "user_test", capabilities: {} });
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user_test" });
});

describe("POST /api/studio/lookup", () => {
  it("routes a store-hours question to the places tool", async () => {
    mocks.executePlacesLookup.mockResolvedValue({
      success: true,
      formatted: "Best Buy (123 Main St) is open now. Source: Google Places.",
    });

    const res = await POST(req({ query: "What time does Best Buy open?" }));
    const body = await res.json();

    expect(mocks.executePlacesLookup).toHaveBeenCalledWith(expect.anything(), "Best Buy");
    expect(mocks.executeWebSearch).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.formatted).toContain("Source: Google Places");
    expect(body.source).toBe("Google Places");
  });

  it("falls back to web search for a generic factual question", async () => {
    mocks.executeWebSearch.mockResolvedValue({
      success: true,
      provider: "brave_search",
      formatted: "Here's what I found...",
    });

    const res = await POST(req({ query: "what's the latest news about LiTT" }));
    const body = await res.json();

    expect(mocks.executePlacesLookup).not.toHaveBeenCalled();
    expect(mocks.executeWebSearch).toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.source).toBe("Brave Search");
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: null });

    const res = await POST(req({ query: "Best Buy hours" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the query is missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the query is not a string", async () => {
    const res = await POST(req({ query: 123 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when the query exceeds the length cap", async () => {
    const res = await POST(req({ query: "a".repeat(501) }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("reports a handled failure instead of throwing when getUserContext rejects", async () => {
    mocks.getUserContext.mockRejectedValueOnce(new Error("db unavailable"));

    const res = await POST(req({ query: "Best Buy hours" }));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});
