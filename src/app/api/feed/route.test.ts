import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// Signed-in user, but the Supabase backend is NOT configured (mock mode) —
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: vi.fn(),
  isAdminSupabaseConfigured: vi.fn(() => false),
}));

describe("POST /api/feed in mock mode", () => {
  it("returns 503 with an honest error instead of a fake success", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello world" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toMatch(/isn.t connected yet/);
    expect(data.success).toBeUndefined();
    expect(data.mock).toBeUndefined();
  });
});
