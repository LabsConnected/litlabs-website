import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, MockHandler, MockRow } from "./test-supabase-mock";
import {
  encodeCursor,
  decodeCursor,
  isPostVisibleTo,
  listPosts,
} from "./social-feed";

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => mockClient,
  isAdminSupabaseConfigured: () => true,
}));

// In-memory posts: 12 public posts by db-author (p00 oldest .. p11 newest),
// one followers-only post by a followed author, one by a stranger, one private.
function makePosts(): MockRow[] {
  const base = new Date("2026-09-16T12:00:00.000Z").getTime();
  const posts: MockRow[] = [];
  for (let i = 0; i < 12; i++) {
    posts.push({
      id: `p${String(i).padStart(2, "0")}`,
      user_id: "db-author",
      content: `public ${i}`,
      media_urls: [],
      post_type: "text",
      visibility: "public",
      likes_count: 0,
      comments_count: 0,
      reposts_count: 0,
      saves_count: 0,
      shares_count: 0,
      created_at: new Date(base - (11 - i) * 60000).toISOString(),
      updated_at: new Date(base - (11 - i) * 60000).toISOString(),
      users: { username: "author", name: "Author", avatar_url: null },
    });
  }
  posts.push({
    id: "f-followed",
    user_id: "db-followed",
    content: "followers only",
    media_urls: [],
    post_type: "text",
    visibility: "followers",
    likes_count: 0,
    comments_count: 0,
    reposts_count: 0,
    saves_count: 0,
    shares_count: 0,
    created_at: new Date(base + 60000).toISOString(),
    updated_at: new Date(base + 60000).toISOString(),
    users: { username: "followed", name: "Followed", avatar_url: null },
  });
  posts.push({
    id: "f-stranger",
    user_id: "db-stranger",
    content: "stranger followers only",
    media_urls: [],
    post_type: "text",
    visibility: "followers",
    likes_count: 0,
    comments_count: 0,
    reposts_count: 0,
    saves_count: 0,
    shares_count: 0,
    created_at: new Date(base + 120000).toISOString(),
    updated_at: new Date(base + 120000).toISOString(),
    users: { username: "stranger", name: "Stranger", avatar_url: null },
  });
  posts.push({
    id: "priv-1",
    user_id: "db-owner",
    content: "private",
    media_urls: [],
    post_type: "text",
    visibility: "private",
    likes_count: 0,
    comments_count: 0,
    reposts_count: 0,
    saves_count: 0,
    shares_count: 0,
    created_at: new Date(base + 180000).toISOString(),
    updated_at: new Date(base + 180000).toISOString(),
    users: { username: "owner", name: "Owner", avatar_url: null },
  });
  return posts;
}

const posts = makePosts();

const inMemoryHandler: MockHandler = (table, ops) => {
  if (table === "follows") {
    const eqFollower = ops.find((o) => o.op === "eq" && o.args[0] === "follower_id");
    if (eqFollower && eqFollower.args[1] === "db-viewer") {
      return { data: [{ followee_id: "db-followed" }] };
    }
    return { data: [] };
  }
  if (table === "posts") {
    let rows = [...posts];
    for (const op of ops) {
      if (op.op === "eq" && op.args[0] === "visibility") {
        rows = rows.filter((r) => r.visibility === op.args[1]);
      }
      if (op.op === "eq" && op.args[0] === "id") {
        rows = rows.filter((r) => r.id === op.args[1]);
      }
      if (op.op === "in" && op.args[0] === "user_id") {
        rows = rows.filter((r) => op.args[1].includes(r.user_id));
      }
      if (op.op === "in" && op.args[0] === "visibility") {
        rows = rows.filter((r) => op.args[1].includes(r.visibility));
      }
      if (op.op === "or") {
        const m = String(op.args[0]).match(
          /created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)/,
        );
        if (m) {
          const [, lt, eqT, ltId] = m;
          rows = rows.filter((r) => r.created_at < lt || (r.created_at === eqT && r.id < ltId));
        }
      }
    }
    rows.sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const limitOp = ops.find((o) => o.op === "limit");
    if (limitOp) rows = rows.slice(0, limitOp.args[0]);
    if (ops.some((o) => o.op === "single" || o.op === "maybeSingle")) {
      return { data: rows[0] ?? null };
    }
    return { data: rows };
  }
  return { data: [] };
};

const mockClient = createMockSupabase((table, ops) => inMemoryHandler(table, ops));

describe("isPostVisibleTo", () => {
  it("public posts are visible to everyone, including signed-out", () => {
    expect(isPostVisibleTo({ user_id: "a", visibility: "public" }, null, false)).toBe(true);
    expect(isPostVisibleTo({ user_id: "a", visibility: "public" }, "b", false)).toBe(true);
  });
  it("private posts are visible only to the author", () => {
    expect(isPostVisibleTo({ user_id: "a", visibility: "private" }, "a", false)).toBe(true);
    expect(isPostVisibleTo({ user_id: "a", visibility: "private" }, "b", true)).toBe(false);
    expect(isPostVisibleTo({ user_id: "a", visibility: "private" }, null, false)).toBe(false);
  });
  it("followers posts are visible to followers and the author", () => {
    expect(isPostVisibleTo({ user_id: "a", visibility: "followers" }, "b", true)).toBe(true);
    expect(isPostVisibleTo({ user_id: "a", visibility: "followers" }, "a", false)).toBe(true);
    expect(isPostVisibleTo({ user_id: "a", visibility: "followers" }, "b", false)).toBe(false);
  });
  it("crew falls back to the follows graph until Phase 4", () => {
    expect(isPostVisibleTo({ user_id: "a", visibility: "crew" }, "b", true)).toBe(true);
    expect(isPostVisibleTo({ user_id: "a", visibility: "crew" }, "b", false)).toBe(false);
  });
});

describe("cursor encode/decode", () => {
  it("round-trips", () => {
    const enc = encodeCursor("2026-09-16T12:00:00.000Z", "post-1");
    expect(decodeCursor(enc)).toEqual({ t: "2026-09-16T12:00:00.000Z", i: "post-1" });
  });
  it("returns null for garbage", () => {
    expect(decodeCursor("!!!")).toBe(null);
    expect(decodeCursor(null)).toBe(null);
  });
});

describe("listPosts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("paginates with no duplicates across pages and ends with a null cursor", async () => {
    const page1 = await listPosts({ viewerDbId: null, tab: "for-you", limit: 10 });
    expect(page1.posts).toHaveLength(10);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await listPosts({ viewerDbId: null, tab: "for-you", cursor: page1.nextCursor, limit: 10 });
    expect(page2.posts).toHaveLength(2); // 12 public posts total
    expect(page2.nextCursor).toBe(null);

    const ids1 = new Set(page1.posts.map((p) => p.id));
    const ids2 = page2.posts.map((p) => p.id);
    expect(ids2.every((id) => !ids1.has(id))).toBe(true);
    expect(page1.posts).toHaveLength(new Set([...ids1]).size);
  });

  it("hides followers-only and private posts from signed-out viewers", async () => {
    const res = await listPosts({ viewerDbId: null, tab: "for-you", limit: 25 });
    const ids = res.posts.map((p) => p.id);
    expect(ids).not.toContain("f-followed");
    expect(ids).not.toContain("f-stranger");
    expect(ids).not.toContain("priv-1");
  });

  it("shows followed-author followers posts to a follower but not stranger ones", async () => {
    const res = await listPosts({ viewerDbId: "db-viewer", tab: "for-you", limit: 25 });
    const ids = res.posts.map((p) => p.id);
    expect(ids).toContain("f-followed");
    expect(ids).not.toContain("f-stranger");
    expect(ids).not.toContain("priv-1");
  });

  it("following tab includes followed authors' posts", async () => {
    const res = await listPosts({ viewerDbId: "db-viewer", tab: "following", limit: 25 });
    const ids = res.posts.map((p) => p.id);
    expect(ids).toContain("f-followed");
    expect(ids).not.toContain("f-stranger");
  });

  it("clamps limit to 1..25", async () => {
    const res = await listPosts({ viewerDbId: null, tab: "for-you", limit: 500 });
    expect(res.posts.length).toBeLessThanOrEqual(25);
  });
});
