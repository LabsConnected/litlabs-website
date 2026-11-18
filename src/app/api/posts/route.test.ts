import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase, MockHandler, MockRow } from "@/lib/test-supabase-mock";

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

describe("POST /api/posts projectRef round-trip", () => {
  const sentRef = {
    projectId: "studio-proj-1",
    name: "Dune Brew",
    url: "https://litlabs.net/studio/dune-brew",
  };
  let insertedRow: MockRow | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "clerk-abc", clerkId: "clerk-abc" });
    supabaseConfigured = true;
    insertedRow = null;
    handlerFn = (table, ops) => {
      if (table === "users") return { data: { id: "db-user-1", username: "tester" } };
      if (table === "posts") {
        const insertOp = ops.find((o) => o.op === "insert");
        if (insertOp) {
          const payload = insertOp.args[0] as MockRow;
          insertedRow = {
            id: "post-new",
            user_id: payload.user_id,
            content: payload.content,
            media_urls: payload.media_urls,
            post_type: payload.post_type,
            visibility: payload.visibility,
            project_ref: payload.project_ref,
            likes_count: 0,
            comments_count: 0,
            reposts_count: 0,
            saves_count: 0,
            shares_count: 0,
            link_url: null,
            link_title: null,
            link_description: null,
            link_image_url: null,
            music_title: null,
            music_artist: null,
            music_url: null,
            created_at: "2026-11-13T12:00:00.000Z",
            updated_at: "2026-11-13T12:00:00.000Z",
            users: { username: "tester", name: "Tester", avatar_url: null },
          };
          return { data: { id: "post-new" } };
        }
        let rows: MockRow[] = insertedRow ? [insertedRow] : [];
        for (const op of ops) {
          if (op.op === "eq" && op.args[0] === "visibility") {
            rows = rows.filter((r) => r.visibility === op.args[1]);
          }
          if (op.op === "eq" && op.args[0] === "id") {
            rows = rows.filter((r) => r.id === op.args[1]);
          }
        }
        if (ops.some((o) => o.op === "single" || o.op === "maybeSingle")) {
          return { data: rows[0] ?? null };
        }
        return { data: rows };
      }
      return { data: [] };
    };
  });

  function postProject(body: Record<string, unknown>) {
    return import("./route").then(({ POST }) =>
      POST(
        req("http://localhost:3000/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
  }

  it("accepts the object projectRef, stores it as JSON in project_ref, and reads back the identical object", async () => {
    const res = await postProject({ content: "Shipped a thing", postType: "project", projectRef: sentRef });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.projectRef).toEqual(sentRef);

    // Storage contract: a JSON string in the TEXT column — not a bare id.
    expect(typeof insertedRow?.project_ref).toBe("string");
    expect(JSON.parse(insertedRow?.project_ref as string)).toEqual(sentRef);

    // The feed read path returns the identical object too.
    const feedRes = await GET(req("http://localhost:3000/api/posts?tab=for-you&limit=10"));
    expect(feedRes.status).toBe(200);
    const feed = await feedRes.json();
    const fromFeed = (feed.posts as { id: string; projectRef: unknown }[]).find((p) => p.id === "post-new");
    expect(fromFeed?.projectRef).toEqual(sentRef);
  });

  it("a project post with only a valid projectRef (no content) is accepted", async () => {
    const res = await postProject({ postType: "project", projectRef: sentRef });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.projectRef).toEqual(sentRef);
  });

  it("ignores a malformed projectRef instead of storing it", async () => {
    const res = await postProject({
      content: "hello",
      postType: "project",
      projectRef: { projectId: "studio-proj-1" }, // no name → not a ref
    });
    expect(res.status).toBe(201);
    expect(insertedRow?.project_ref).toBeNull();
    const body = await res.json();
    expect(body.post.projectRef).toBeNull();
  });

  it("does not store a projectRef on non-project posts", async () => {
    const res = await postProject({ content: "hello", postType: "text", projectRef: sentRef });
    expect(res.status).toBe(201);
    expect(insertedRow?.project_ref).toBeNull();
  });
});
