// @vitest-environment node
// P1-4: Marketplace uninstall honesty — regression tests.
//
// The fake-success chain was:
//  1. MyAITeam sent the user_agents installation ROW id to
//     /api/marketplace/agents/[id]/install (which routes on the marketplace
//     agent id) — zero rows ever matched.
//  2. uninstallAgent() returned { success: true } even when the DELETE
//     matched zero rows.
//  3. AgentDetailClient flipped the UI to "install" without checking res.ok.
//
// These tests pin the backend honesty: uninstalling something that is not
// installed (or identified by the wrong id) must answer 404, never 200.
//
// Run: pnpm exec vitest run tests/p1-4-uninstall-honesty.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
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
  q.single = vi.fn(() => Promise.resolve(mocks.singleResults[table] ?? { data: null, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve(mocks.singleResults[table] ?? { data: null, error: null }));
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
    from: (table: string) => makeQuery(table),
  },
}));

const { uninstallAgent } = await import("@/lib/agent-entitlements");
const { DELETE } = await import("@/app/api/marketplace/agents/[id]/install/route");

function req(url: string, init?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, init as never);
}

describe("P1-4 marketplace uninstall honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results = {};
    mocks.singleResults = {};
    mocks.selectArgs = {};
    mocks.auth.mockResolvedValue({ clerkId: "clerk_u1" });
    mocks.singleResults["users"] = { data: { id: "db_u1" }, error: null };
  });

  it("uninstallAgent reports not_installed when the delete matches zero rows", async () => {
    // The old MyAITeam wrong-ID bug: the client sent the installation ROW id,
    // which matches no user_agents.agent_id — the delete affects zero rows.
    mocks.results["user_agents"] = { data: [], error: null };

    const result = await uninstallAgent("clerk_u1", "installation-row-id-not-agent-id");

    expect(result.success).toBe(false);
    expect(result.error).toBe("not_installed");
  });

  it("uninstallAgent succeeds only when the delete actually removes a row", async () => {
    mocks.results["user_agents"] = { data: [{ id: "inst-1" }], error: null };

    const result = await uninstallAgent("clerk_u1", "agent-marketplace-id");

    expect(result.success).toBe(true);
    // Honesty guard: the backend must confirm the deletion (select the rows),
    // not assume it happened.
    expect(mocks.selectArgs["user_agents"]).toEqual(["id"]);
  });

  it("DELETE returns 404 when nothing was installed (wrong id included)", async () => {
    mocks.results["user_agents"] = { data: [], error: null };

    const res = await DELETE(
      req("/api/marketplace/agents/installation-row-id/install", { method: "DELETE" }),
      { params: Promise.resolve({ id: "installation-row-id" }) },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Agent not installed");
  });

  it("DELETE returns 200 and the uninstalled message when the row is removed", async () => {
    mocks.results["user_agents"] = { data: [{ id: "inst-1" }], error: null };

    const res = await DELETE(
      req("/api/marketplace/agents/agent-marketplace-id/install", { method: "DELETE" }),
      { params: Promise.resolve({ id: "agent-marketplace-id" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Agent uninstalled");
    expect(body.state).toBe("install");
  });

  it("DELETE returns 401 when not signed in", async () => {
    mocks.auth.mockResolvedValue({ clerkId: null });

    const res = await DELETE(
      req("/api/marketplace/agents/agent-marketplace-id/install", { method: "DELETE" }),
      { params: Promise.resolve({ id: "agent-marketplace-id" }) },
    );

    expect(res.status).toBe(401);
  });
});
