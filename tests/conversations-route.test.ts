// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  // Per-table results for chained queries that resolve via .then (no .single)
  results: {} as Record<string, { data: unknown; error: unknown }>,
  // Per-table results for .single() calls
  singleResults: {} as Record<string, { data: unknown; error: unknown }>,
  selectArgs: {} as Record<string, unknown[]>,
}));

function makeQuery(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "neq", "limit", "gte", "lte", "is", "not", "insert", "update", "delete"]) {
    q[m] = vi.fn((...args: unknown[]) => {
      if (m === "select") mocks.selectArgs[table] = args;
      return q;
    });
  }
  q.single = vi.fn(() =>
    Promise.resolve(mocks.singleResults[table] ?? { data: null, error: null }),
  );
  q.then = (res: (v: unknown) => unknown) =>
    Promise.resolve(mocks.results[table] ?? { data: [], error: null }).then(res);
  return q;
}

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: unknown) => handler,
}));
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      mocks.from(table);
      return makeQuery(table);
    },
  },
}));

const { GET, POST } = await import("@/app/api/conversations/route");

function req(url: string, init?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, init as never);
}

describe("GET /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results = {};
    mocks.singleResults = {};
    mocks.selectArgs = {};
    mocks.auth.mockResolvedValue({ userId: "clerk_u1" });
    mocks.singleResults["users"] = { data: { id: "db_u1" }, error: null };
  });

  it("returns 200 with conversations — no PostgREST embed on the TEXT agent_id", async () => {
    mocks.results["conversations"] = {
      data: [
        { id: "c1", user_id: "db_u1", agent_id: "agent-1", title: "Chat A", updated_at: "2026-09-15T00:00:00Z" },
      ],
      error: null,
    };
    mocks.results["agents"] = {
      data: [{ id: "agent-1", display_name: "LiTT" }],
      error: null,
    };

    const res = await GET(req("/api/conversations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].agent?.display_name).toBe("LiTT");

    // Regression: the select must be a plain "*" — the agent:agent_id(*)
    // embed 500s permanently because agent_id is TEXT, not an FK.
    expect(mocks.selectArgs["conversations"]).toEqual(["*"]);
    // Agent names resolved via a separate batch lookup, not an embed.
    expect(mocks.from).toHaveBeenCalledWith("agents");
  });

  it("returns agent:null when no agent name resolves", async () => {
    mocks.results["conversations"] = {
      data: [{ id: "c1", user_id: "db_u1", agent_id: "missing-agent", title: null, updated_at: "2026-09-15T00:00:00Z" }],
      error: null,
    };
    mocks.results["agents"] = { data: [], error: null };

    const res = await GET(req("/api/conversations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations[0].agent).toBeNull();
  });

  it("still 500s when the conversations query itself fails", async () => {
    mocks.results["conversations"] = { data: null, error: { message: "db down" } };
    const res = await GET(req("/api/conversations"));
    expect(res.status).toBe(500);
  });

  it("401s when unauthenticated", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const res = await GET(req("/api/conversations"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results = {};
    mocks.singleResults = {};
    mocks.selectArgs = {};
    mocks.auth.mockResolvedValue({ userId: "clerk_u1" });
    mocks.singleResults["users"] = { data: { id: "db_u1" }, error: null };
  });

  it("returns the created conversation with the fetched agent, no embed", async () => {
    mocks.singleResults["agents"] = { data: { display_name: "LiTT" }, error: null };
    const insertRow = { id: "c9", agent_id: "agent-1", title: "Chat with LiTT" };
    // insert().select().single() — single resolves the row
    mocks.singleResults["conversations"] = { data: insertRow, error: null };

    // The insert chain needs .insert on the query object — add via makeQuery? Not covered.
    // Assert via response: POST should 200.
    const res = await POST(
      req("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", title: undefined }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.agent?.display_name).toBe("LiTT");
  });
});
