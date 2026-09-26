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

// resolveDbUser is the established Clerk-id -> public.users(id) resolver.
// The whole point of this route's fix is that it must be used before
// inserting into posts.user_id (FK to public.users, not auth.users).
const mockResolveDbUser = vi.fn();
vi.mock("@/lib/social-feed", () => ({
  resolveDbUser: (...args: unknown[]) => mockResolveDbUser(...args),
}));

const { POST } = await import("./route");

const GALLERY_ITEM = {
  id: "item-1",
  user_id: "clerk-user-1",
  title: "My Art",
  image_url: "https://example.com/img.png",
  video_url: null,
  media_type: "image",
};

let capturedInsert: Record<string, unknown> | null = null;

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/gallery/item-1/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/gallery/[id]/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInsert = null;
    supabaseConfigured = true;
    mockAuth.mockResolvedValue({ userId: "clerk-user-1" });
    mockResolveDbUser.mockResolvedValue({ id: "db-uuid-1", username: "tester" });
    handlerFn = (table, ops) => {
      if (table === "gallery_items") {
        const idEq = ops.find((o) => o.op === "eq" && o.args[0] === "id");
        const userEq = ops.find((o) => o.op === "eq" && o.args[0] === "user_id");
        if (
          idEq?.args[1] === GALLERY_ITEM.id &&
          userEq?.args[1] === GALLERY_ITEM.user_id
        ) {
          return { data: GALLERY_ITEM };
        }
        return { data: null };
      }
      if (table === "posts") {
        const insertOp = ops.find((o) => o.op === "insert");
        capturedInsert = insertOp?.args[0] ?? null;
        return { data: { id: "post-123" } };
      }
      return { data: [] };
    };
  });

  it("inserts the post with the DB user UUID (not the raw Clerk id)", async () => {
    const res = await POST(req({ content: "look at this" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, postId: "post-123" });
    // Regression guard: posts.user_id is a FK to public.users(id). Inserting
    // the raw Clerk id violated the FK and made every share 500.
    expect(mockResolveDbUser).toHaveBeenCalledWith("clerk-user-1");
    expect(capturedInsert?.user_id).toBe("db-uuid-1");
  });

  it("returns 409 when the caller has no DB user row yet", async () => {
    mockResolveDbUser.mockResolvedValue(null);
    const res = await POST(req({}), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(409);
    expect(capturedInsert).toBeNull();
  });

  it("returns 404 for another user's item", async () => {
    const res = await POST(req({}), {
      params: Promise.resolve({ id: "item-999" }),
    });
    expect(res.status).toBe(404);
    expect(capturedInsert).toBeNull();
  });

  it("returns 401 when signed out", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(req({}), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns an honest 503 (never a fake success) when the backend isn't connected", async () => {
    supabaseConfigured = false;
    const res = await POST(req({}), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/isn't connected yet/);
    expect(body.ok).toBeUndefined();
  });
});
