// src/lib/rate-limiter.test.ts
// Regression coverage for the rate-limit key derivation. A request must
// never be able to choose its own bucket: identity headers are
// client-controlled, and the client-facing end of X-Forwarded-For is
// client-controlled too. Only the verified Clerk session or the
// edge-appended (last) XFF entry may decide the key.
//
// Buckets are also scoped per route pattern: one route's traffic must
// never consume another route's budget (the action-run 429 defect —
// a single shared per-user counter was incremented by every route and
// every client poller until unrelated polls started returning 429).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  seenKeys: [] as string[],
  store: new Map<string, { count: number; window_start: number }>(),
  supabaseNull: { value: false },
}));
const mockAuth = vi.fn<() => Promise<{ userId: string | null }>>();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    if (h.supabaseNull.value) return null;
    return {
      from: () => ({
        select: () => ({
          eq: (_col: string, val: string) => {
            h.seenKeys.push(val);
            return {
              single: async () => ({ data: h.store.get(val) ?? null, error: null }),
            };
          },
        }),
        upsert: async (row: { key: string; count: number; window_start: number }) => {
          h.store.set(row.key, { count: row.count, window_start: row.window_start });
          return {};
        },
      }),
    };
  },
}));

vi.mock("@/lib/api-route-helpers", () => ({
  newRequestId: () => "req_test",
}));

vi.mock("@/lib/metrics", () => ({
  httpRequestTotal: { labels: () => ({ inc: () => {} }) },
  httpRequestDurationSeconds: { labels: () => ({ observe: () => {} }) },
}));

import { rateLimit } from "./rate-limiter";

function req(headers: Record<string, string> = {}, path = "/api/expensive") {
  return new NextRequest(`https://app.test${path}`, { headers });
}

describe("rateLimit key derivation", () => {
  beforeEach(() => {
    h.seenKeys.length = 0;
    h.store.clear();
    h.supabaseNull.value = false;
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
    expect(h.seenKeys[0]).toBe("rl_203.0.113.7:/api/expensive");
  });

  it("uses the LAST x-forwarded-for entry (edge-appended, not client-controlled)", async () => {
    await rateLimit(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.9" }));
    expect(h.seenKeys[0]).toBe("rl_198.51.100.9:/api/expensive");
  });

  it("a spoofed XFF head cannot mint a bucket", async () => {
    await rateLimit(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" }));
    await rateLimit(req({ "x-forwarded-for": "8.8.8.8, 198.51.100.9" }));
    expect(h.seenKeys).toEqual([
      "rl_198.51.100.9:/api/expensive",
      "rl_198.51.100.9:/api/expensive",
    ]);
  });

  it("keys on the verified session user when authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: "user_verified_123" });
    await rateLimit(
      req({ "x-user-id": "spoofed", "x-forwarded-for": "203.0.113.7" }),
    );
    expect(h.seenKeys[0]).toBe("rl_user_user_verified_123:/api/expensive");
  });

  it("falls back to a shared unknown bucket when no IP is derivable", async () => {
    await rateLimit(req());
    expect(h.seenKeys[0]).toBe("rl_unknown:/api/expensive");
  });
});

describe("rateLimit route-scoped buckets", () => {
  beforeEach(() => {
    h.seenKeys.length = 0;
    h.store.clear();
    h.supabaseNull.value = false;
    mockAuth.mockResolvedValue({ userId: null });
  });

  it("one route hitting its limit does not 429 a different route for the same user", async () => {
    mockAuth.mockResolvedValue({ userId: "user_scoped" });
    expect((await rateLimit(req({}, "/api/route-x"), 2, 60)).success).toBe(true);
    expect((await rateLimit(req({}, "/api/route-x"), 2, 60)).success).toBe(true);
    expect((await rateLimit(req({}, "/api/route-x"), 2, 60)).success).toBe(false);
    expect((await rateLimit(req({}, "/api/route-y"), 2, 60)).success).toBe(true);
  });

  it("normalizes UUID path segments so conversations share one route-pattern bucket", async () => {
    mockAuth.mockResolvedValue({ userId: "user_uuid" });
    await rateLimit(
      req({}, "/api/studio/conversations/11111111-2222-3333-4444-555555555555/action-run"),
      60,
      60,
    );
    await rateLimit(
      req({}, "/api/studio/conversations/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/action-run"),
      60,
      60,
    );
    expect(h.seenKeys[0]).toBe(
      "rl_user_user_uuid:/api/studio/conversations/:id/action-run",
    );
    expect(h.seenKeys[1]).toBe(h.seenKeys[0]);
  });

  it("normalizes numeric id path segments", async () => {
    await rateLimit(req({}, "/api/items/123"), 60, 60);
    await rateLimit(req({}, "/api/items/456"), 60, 60);
    expect(h.seenKeys[0]).toBe("rl_unknown:/api/items/:id");
    expect(h.seenKeys[1]).toBe(h.seenKeys[0]);
  });

  it("scopes the unauthenticated IP bucket per route too", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    expect((await rateLimit(req(headers, "/api/route-x"), 2, 60)).success).toBe(true);
    expect((await rateLimit(req(headers, "/api/route-x"), 2, 60)).success).toBe(true);
    expect((await rateLimit(req(headers, "/api/route-x"), 2, 60)).success).toBe(false);
    expect((await rateLimit(req(headers, "/api/route-y"), 2, 60)).success).toBe(true);
  });

  it("the in-process fallback is route-scoped too", async () => {
    h.supabaseNull.value = true;
    mockAuth.mockResolvedValue({ userId: "user_fallback_scoped" });
    expect((await rateLimit(req({}, "/api/route-x"), 2, 60)).success).toBe(true);
    expect((await rateLimit(req({}, "/api/route-x"), 2, 60)).success).toBe(true);
    expect((await rateLimit(req({}, "/api/route-x"), 2, 60)).success).toBe(false);
    expect((await rateLimit(req({}, "/api/route-y"), 2, 60)).success).toBe(true);
  });
});
