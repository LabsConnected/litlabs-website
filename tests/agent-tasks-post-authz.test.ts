// @vitest-environment node
/**
 * Authorization tests for POST /api/agent-tasks.
 *
 * The session-ownership guard must FAIL CLOSED: a foreign task in the
 * session → 403, and a lookup error → 500 rather than silently skipping
 * the check. The check queries for a foreign row directly
 * (.neq("user_id", caller)) so row ordering cannot mask an injection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuth, state } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  state: {
    foreignRow: null as unknown,
    ownershipError: null as { message: string } | null,
    insertCalled: false,
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/agent-logger", () => ({ logAgentEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/agent-validation", () => ({
  validateAgentTaskInput: () => ({ ok: true, errors: [] }),
  checkPromptSafety: () => ({ ok: true }),
}));

vi.mock("@/lib/supabase", () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.neq = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = () =>
    Promise.resolve({ data: state.foreignRow, error: state.ownershipError });
  builder.insert = () => {
    state.insertCalled = true;
    return builder;
  };
  builder.single = () =>
    Promise.resolve({ data: { id: "task_1", session_id: "s" }, error: null });
  // The sequence-order count query awaits the builder itself.
  builder.then = (res: (v: unknown) => unknown) =>
    res({ count: 0, error: null });
  return {
    getSupabaseAdmin: () => ({}),
    supabaseAdmin: { from: () => builder },
  };
});

const VALID_SESSION = "123e4567-e89b-12d3-a456-426614174000";

async function callPost(sessionId: string) {
  const { POST } = await import("@/app/api/agent-tasks/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://localhost/api/agent-tasks", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      assignedTo: "agent",
      dispatcher: "user",
      taskInput: { prompt: "do the thing" },
    }),
  });
  return POST(req);
}

describe("POST /api/agent-tasks — session ownership (fail closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.foreignRow = null;
    state.ownershipError = null;
    state.insertCalled = false;
    mockAuth.mockResolvedValue({ userId: "clerk_alice" });
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await callPost(VALID_SESSION);
    expect(res.status).toBe(401);
    expect(state.insertCalled).toBe(false);
  });

  it("allows the write when the session has no foreign tasks", async () => {
    const res = await callPost(VALID_SESSION);
    expect(res.status).toBe(201);
    expect(state.insertCalled).toBe(true);
  });

  it("returns 403 when another user already owns a task in the session", async () => {
    state.foreignRow = { id: "t9" };
    const res = await callPost(VALID_SESSION);
    expect(res.status).toBe(403);
    expect(state.insertCalled).toBe(false);
  });

  it("returns 500 — fail closed — when the ownership lookup errors", async () => {
    state.ownershipError = { message: "connection reset" };
    const res = await callPost(VALID_SESSION);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/ownership/i);
    expect(state.insertCalled).toBe(false);
  });

  it("returns 400 for a non-UUID session_id before touching the database", async () => {
    const res = await callPost("not-a-uuid");
    expect(res.status).toBe(400);
    expect(state.insertCalled).toBe(false);
  });
});
