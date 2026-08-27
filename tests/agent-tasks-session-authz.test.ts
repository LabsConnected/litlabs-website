// @vitest-environment node
/**
 * Authorization regression tests for
 * GET /api/agent-tasks/session/[sessionId].
 *
 * This route reads `agent_tasks` with the SERVICE ROLE key, which
 * bypasses RLS. That makes the query's WHERE clause the only boundary
 * between one user's data and another's — so the ownership filter is a
 * security control, not a convenience, and it gets a test.
 *
 * The route previously filtered on session_id alone: any authenticated
 * user who knew or guessed a sessionId could read another user's tasks,
 * including the prompts and results in task_input / task_output.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

/**
 * Minimal Supabase query-builder double that records the `.eq()` filters
 * it was given and serves rows only to their real owner — i.e. it
 * behaves like the database, so a route that forgets to scope by user
 * actually leaks here rather than passing on a lenient stub.
 */
const ROWS = [
  { id: "t1", session_id: "sess-A", user_id: "clerk_alice", sequence_order: 1, task_input: { prompt: "alice secret" } },
  { id: "t2", session_id: "sess-A", user_id: "clerk_alice", sequence_order: 2, task_input: { prompt: "alice secret 2" } },
  // Pre-migration row: never backfilled, belongs to nobody.
  { id: "t3", session_id: "sess-A", user_id: null, sequence_order: 3, task_input: { prompt: "orphan" } },
];

let lastFilters: Record<string, unknown>;

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      lastFilters = filters;
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        order: () => {
          const data = ROWS.filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k as keyof typeof r] === v),
          );
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
  }),
}));

async function callRoute(sessionId: string) {
  const { GET } = await import("@/app/api/agent-tasks/session/[sessionId]/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(`http://localhost/api/agent-tasks/session/${sessionId}`);
  return GET(req, { params: Promise.resolve({ sessionId }) });
}

describe("GET /api/agent-tasks/session/[sessionId] — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastFilters = {};
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await callRoute("sess-A");
    expect(res.status).toBe(401);
  });

  it("returns the owner's tasks for their own session", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_alice" });
    const res = await callRoute("sess-A");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(["t1", "t2"]);
  });

  it("does NOT leak another user's tasks to a user who knows the sessionId", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_mallory" });
    const res = await callRoute("sess-A");
    expect(res.status).toBe(200);
    const body = await res.json();
    // The load-bearing assertion: same sessionId, different user, no rows.
    expect(body.tasks).toEqual([]);
  });

  it("scopes the query by user_id, not session_id alone", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_alice" });
    await callRoute("sess-A");
    expect(lastFilters).toMatchObject({
      session_id: "sess-A",
      user_id: "clerk_alice",
    });
  });

  it("never serves unattributable (user_id NULL) rows", async () => {
    for (const who of ["clerk_alice", "clerk_mallory"]) {
      mockAuth.mockResolvedValue({ userId: who });
      const res = await callRoute("sess-A");
      const body = await res.json();
      expect(body.tasks.some((t: { id: string }) => t.id === "t3")).toBe(false);
    }
  });

  it("returns 400 for an empty sessionId", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_alice" });
    const res = await callRoute("");
    expect(res.status).toBe(400);
  });
});
