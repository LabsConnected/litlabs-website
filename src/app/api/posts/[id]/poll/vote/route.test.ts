import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase, MockHandler } from "@/lib/test-supabase-mock";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

let handlerFn: MockHandler = () => ({ data: [] });
const mockClient = createMockSupabase((table, ops) => handlerFn(table, ops));
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => mockClient,
  isAdminSupabaseConfigured: () => true,
}));

const { POST } = await import("./route");

const VIEWER = { id: "db-viewer", username: "viewer" };
const pollPost = {
  id: "post-poll",
  user_id: "db-owner",
  content: "pick one",
  media_urls: [],
  post_type: "poll",
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
const pollRow = { id: "poll-1", post_id: "post-poll", question: "pick one", ends_at: null };
const options = [
  { id: "opt-a", poll_id: "poll-1", text: "A", votes_count: 3, position: 0 },
  { id: "opt-b", poll_id: "poll-1", text: "B", votes_count: 1, position: 1 },
];

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/posts/post-poll/poll/vote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: "post-poll" }) };
}

function baseHandler(existingVotes: unknown[]): MockHandler {
  return (table, ops) => {
    if (table === "users") return { data: VIEWER };
    if (table === "posts") return { data: { ...pollPost } };
    if (table === "follows") return { data: [] };
    if (table === "post_polls") return { data: [pollRow] };
    if (table === "poll_options") {
      // route's option check uses eq(id).eq(poll_id).single()
      const eqId = ops.find((o) => o.op === "eq" && o.args[0] === "id");
      if (eqId) {
        const found = options.find((o) => o.id === eqId.args[1]);
        return found ? { data: found } : { data: null };
      }
      return { data: options };
    }
    if (table === "poll_votes") {
      const isMatch = ops.some((o) => o.op === "match");
      return { data: isMatch ? (existingVotes.length > 0 ? existingVotes[0] : null) : existingVotes };
    }
    return { data: [] };
  };
}

describe("POST /api/posts/[id]/poll/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "clerk-viewer", clerkId: "clerk-viewer" });
  });

  it("records a first vote and returns 201", async () => {
    handlerFn = baseHandler([]);
    const res = await POST(req({ optionId: "opt-a" }), params());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.voted).toBe(true);
    expect(body.optionId).toBe("opt-a");
    expect(body.votes).toBe(4);
    expect(mockClient.rpc).toHaveBeenCalledWith("increment_poll_option_votes", { option_id: "opt-a" });
  });

  it("returns 409 on double vote", async () => {
    handlerFn = baseHandler([{ id: "vote-1", poll_id: "poll-1", option_id: "opt-a" }]);
    const res = await POST(req({ optionId: "opt-b" }), params());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Already voted");
    // No increment RPC on the duplicate path
    expect(mockClient.rpc).not.toHaveBeenCalledWith("increment_poll_option_votes", expect.anything());
  });

  it("returns 410 when the poll is closed", async () => {
    handlerFn = (table, ops) => {
      const base = baseHandler([]);
      if (table === "post_polls") {
        return { data: [{ ...pollRow, ends_at: "2026-01-01T00:00:00.000Z" }] };
      }
      return base(table, ops);
    };
    const res = await POST(req({ optionId: "opt-a" }), params());
    expect(res.status).toBe(410);
  });

  it("returns 400 for an optionId from another poll", async () => {
    handlerFn = baseHandler([]);
    const res = await POST(req({ optionId: "opt-other-poll" }), params());
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    handlerFn = baseHandler([]);
    const res = await POST(req({ optionId: "opt-a" }), params());
    expect(res.status).toBe(401);
  });
});
