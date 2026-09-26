import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase, MockHandler } from "@/lib/test-supabase-mock";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

let handlerFn: MockHandler = () => ({ data: [] });
const mockClient = createMockSupabase((table, ops) => handlerFn(table, ops));
let supabaseConfigured = true;
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => mockClient,
  isAdminSupabaseConfigured: () => supabaseConfigured,
}));

const { GET } = await import("./route");

function req(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
  return new NextRequest(url, init);
}

describe("GET /api/posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    handlerFn = () => ({ data: [] });
    supabaseConfigured = true;
  });

  it("returns the listPosts shape with posts array and nextCursor for signed-out viewers", async () => {
    const res = await GET(req("http://localhost:3000/api/posts?tab=for-you&limit=10"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.posts)).toBe(true);
    expect("nextCursor" in body).toBe(true);
  });

  it("never returns mock data", async () => {
    const res = await GET(req("http://localhost:3000/api/posts"));
    const body = await res.json();
    expect(body.mock).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("mock_1");
  });

  it("returns an honest 503 (not fake posts, not a 500) when the backend isn't connected", async () => {
    supabaseConfigured = false;
    const res = await GET(req("http://localhost:3000/api/posts?tab=for-you&limit=20"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/isn't connected yet/);
    expect(body.posts).toBeUndefined();
    expect(body.mock).toBeUndefined();
  });

  it("returns an honest 500 (not a fake-empty feed) when the database errors", async () => {
    handlerFn = () => ({ data: null, error: { message: "db down" } });
    const res = await GET(req("http://localhost:3000/api/posts?tab=for-you&limit=10"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Couldn't load the feed/);
    expect(body.posts).toBeUndefined();
    expect(body.mock).toBeUndefined();
  });
});

describe("POST /api/posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const res = await (await import("./route")).POST(
      req("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 for empty content", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk-abc", clerkId: "clerk-abc" });
    handlerFn = (table) => {
      if (table === "users") return { data: { id: "db-user-1", username: "tester" } };
      return { data: [] };
    };
    const { POST } = await import("./route");
    const res = await POST(
      req("http://localhost:3000/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
