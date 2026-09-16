import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase, MockHandler, MockRow } from "@/lib/test-supabase-mock";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

let handlerFn: MockHandler = () => ({ data: [] });
const mockClient = createMockSupabase((table, ops) => handlerFn(table, ops));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => mockClient,
  isAdminSupabaseConfigured: () => true,
}));

const { GET, PATCH, DELETE } = await import("./route");

const VIEWER = { id: "db-viewer", username: "viewer" };
const OWNER = { id: "db-owner", username: "owner" };

function req(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
  return new NextRequest(url, init);
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const publicPost: MockRow = {
  id: "post-public",
  user_id: OWNER.id,
  content: "hello world",
  media_urls: [],
  post_type: "text",
  visibility: "public",
  likes_count: 0,
  comments_count: 0,
  reposts_count: 0,
  saves_count: 0,
  shares_count: 0,
  link_url: null,
  link_title: null,
  link_description: null,
  link_image_url: null,
  project_ref: null,
  music_title: null,
  music_artist: null,
  music_url: null,
  created_at: "2026-09-16T00:00:00.000Z",
  updated_at: "2026-09-16T00:00:00.000Z",
  users: { username: "owner", name: "Owner", avatar_url: null },
};

describe("posts/[id] route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "clerk-viewer", clerkId: "clerk-viewer" });
    handlerFn = (table) => {
      if (table === "users") return { data: VIEWER };
      if (table === "posts") return { data: { ...publicPost } };
      if (table === "follows") return { data: [] };
      return { data: [] };
    };
  });

  it("GET returns 404 for a private post the viewer cannot see", async () => {
    handlerFn = (table) => {
      if (table === "users") return { data: VIEWER };
      if (table === "posts")
        return { data: { ...publicPost, visibility: "private", user_id: OWNER.id } };
      return { data: [] };
    };
    const res = await GET(req("http://localhost:3000/api/posts/post-public"), params("post-public"));
    expect(res.status).toBe(404);
  });

  it("GET returns the post DTO for a visible post", async () => {
    const res = await GET(req("http://localhost:3000/api/posts/post-public"), params("post-public"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.id).toBe("post-public");
    expect(body.post.author.username).toBe("owner");
    expect(body.post.counts.likes).toBe(0);
    expect(body.post.viewer.liked).toBe(false);
  });

  it("PATCH another user's post returns 403", async () => {
    const res = await PATCH(
      req("http://localhost:3000/api/posts/post-public", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hijacked" }),
      }),
      params("post-public"),
    );
    expect(res.status).toBe(403);
  });

  it("DELETE another user's post returns 403", async () => {
    const res = await DELETE(req("http://localhost:3000/api/posts/post-public", { method: "DELETE" }), params("post-public"));
    expect(res.status).toBe(403);
  });

  it("PATCH own post succeeds", async () => {
    handlerFn = (table) => {
      if (table === "users") return { data: VIEWER };
      if (table === "posts") return { data: { ...publicPost, user_id: VIEWER.id } };
      if (table === "follows") return { data: [] };
      return { data: [] };
    };
    const res = await PATCH(
      req("http://localhost:3000/api/posts/post-public", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "edited content" }),
      }),
      params("post-public"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.id).toBe("post-public");
    // Verify the update went through the posts table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateCalls = (mockClient.from as any).mock.calls.filter(([t]: [string]) => t === "posts");
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("DELETE own post succeeds", async () => {
    handlerFn = (table) => {
      if (table === "users") return { data: VIEWER };
      if (table === "posts") return { data: { ...publicPost, user_id: VIEWER.id } };
      return { data: [] };
    };
    const res = await DELETE(req("http://localhost:3000/api/posts/post-public", { method: "DELETE" }), params("post-public"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });
});
