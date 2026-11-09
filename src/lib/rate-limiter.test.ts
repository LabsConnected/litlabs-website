// src/lib/rate-limiter.test.ts
// Regression coverage for the rate-limit key derivation. A request must
// never be able to choose its own bucket: identity headers are
// client-controlled, and the client-facing end of X-Forwarded-For is
// client-controlled too. Only the verified Clerk session or the
// edge-appended (last) XFF entry may decide the key.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const seenKeys: string[] = [];
const mockAuth = vi.fn<() => Promise<{ userId: string | null }>>();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, val: string) => {
          seenKeys.push(val);
          return { single: async () => ({ data: null, error: null }) };
        },
      }),
      upsert: async () => ({}),
    }),
  }),
}));

vi.mock("@/lib/api-route-helpers", () => ({
  newRequestId: () => "req_test",
}));

vi.mock("@/lib/metrics", () => ({
  httpRequestTotal: { labels: () => ({ inc: () => {} }) },
  httpRequestDurationSeconds: { labels: () => ({ observe: () => {} }) },
}));

import { rateLimit } from "./rate-limiter";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://app.test/api/expensive", { headers });
}

describe("rateLimit key derivation", () => {
  beforeEach(() => {
    seenKeys.length = 0;
    mockAuth.mockResolvedValue({ userId: null });
  });

  it("ignores client-supplied identity headers entirely", async () => {
    await rateLimit(
      req({
        "x-user-id": "attacker-chosen-id",
        "x-clerk-user-id": "attacker-chosen-id",
        "x-forwarded-for": "203.0.113.7",
      }),
    );
    expect(seenKeys[0]).toBe("rl_203.0.113.7");
  });

  it("uses the LAST x-forwarded-for entry (edge-appended, not client-controlled)", async () => {
    await rateLimit(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.9" }));
    expect(seenKeys[0]).toBe("rl_198.51.100.9");
  });

  it("a spoofed XFF head cannot mint a bucket", async () => {
    await rateLimit(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" }));
    await rateLimit(req({ "x-forwarded-for": "8.8.8.8, 198.51.100.9" }));
    expect(seenKeys).toEqual(["rl_198.51.100.9", "rl_198.51.100.9"]);
  });

  it("keys on the verified session user when authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: "user_verified_123" });
    await rateLimit(
      req({ "x-user-id": "spoofed", "x-forwarded-for": "203.0.113.7" }),
    );
    expect(seenKeys[0]).toBe("rl_user_user_verified_123");
  });

  it("falls back to a shared unknown bucket when no IP is derivable", async () => {
    await rateLimit(req());
    expect(seenKeys[0]).toBe("rl_unknown");
  });
});
