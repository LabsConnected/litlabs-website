import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  userId: "user-a" as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: mocks.userId, clerkId: mocks.userId })),
}));

// Sentinel rate limiter: records every invocation and always answers 429.
// If an anonymous request can still produce 401, the auth gate provably ran
// before the limiter — a shared per-IP bucket can no longer mask the 401.
const limitedSpy = vi.hoisted(() =>
  vi.fn(async () =>
    NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
  ),
);

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: () => limitedSpy,
}));

vi.mock("@/lib/metered-llm-call", () => ({ meteredLlmCall: vi.fn() }));
vi.mock("supermemory", () => ({ Supermemory: class {} }));

import { POST } from "./route";

function req() {
  return new NextRequest("https://staging.example/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("POST /api/ai-chat auth-before-rate-limit ordering", () => {
  beforeEach(() => {
    limitedSpy.mockClear();
    mocks.userId = "user-a";
  });

  it("returns 401 for anonymous requests even when the rate-limit bucket is exhausted", async () => {
    mocks.userId = null;
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(limitedSpy).not.toHaveBeenCalled();
  });

  it("engages the limiter for authenticated callers keyed on the verified user id", async () => {
    const request = req();
    // A client-supplied value must not be trusted — the gate overwrites it
    // with the verified session identity before the limiter reads it.
    request.headers.set("x-clerk-user-id", "attacker-chosen-id");
    const res = await POST(request);
    expect(limitedSpy).toHaveBeenCalledTimes(1);
    expect(request.headers.get("x-clerk-user-id")).toBe("user-a");
    expect(res.status).toBe(429);
  });
});
