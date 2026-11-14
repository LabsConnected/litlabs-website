import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/litt/usage/route";

/**
 * /api/litt/usage model stats must aggregate usage_events — the canonical
 * metering store written by src/lib/metering.ts. The legacy model_usage
 * table has no writer anywhere in the codebase, so reading it made the
 * Settings "Model calls" row permanently zero (ART-20261111-084).
 */

const { tablesQueried, eqCalls, fakeAdmin } = vi.hoisted(() => {
  const tablesQueried: string[] = [];
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const rows: Record<string, unknown[]> = {
    credit_ledger: [
      { id: "l1", direction: "debit", category: "llm", amount: 120 },
      { id: "l2", direction: "credit", category: "subscription_grant", amount: 2500 },
      { id: "l3", direction: "debit", category: "agent_run", amount: 30 },
      { id: "l4", direction: "credit", category: "refund", amount: 10 },
    ],
    usage_events: [
      { model: "gemini-x", provider: "gemini", input_tokens: 100, output_tokens: 50 },
      { model: "gemini-x", provider: "gemini", input_tokens: 200, output_tokens: 80 },
      { model: "gpt-y", provider: "openai", input_tokens: 10, output_tokens: 5 },
    ],
    agent_runs: [
      { id: "r1", status: "completed", model: "gemini-x", provider: "gemini", credits_charged: 0, started_at: "2026-11-10T00:00:00Z", completed_at: null },
      { id: "r2", status: "completed", model: "gemini-x", provider: "gemini", credits_charged: 0, started_at: "2026-11-10T01:00:00Z", completed_at: null },
    ],
  };

  // Head/count queries (the action_runs total) resolve a count, not rows.
  // The fixture is shaped like the REAL store: action_runs.user_id is TEXT
  // holding the Clerk user id (the messages route passes auth()'s userId,
  // which IS the Clerk id, verbatim into action_runtime_create_run). So an
  // action_runs count keyed on the Clerk id finds the 3 Studio runs, while
  // the same count keyed on the internal users.id uuid ("user-uuid-1",
  // the identity usage_events / agent_runs use) finds 0 — the exact
  // production mismatch this suite pins against regression.
  function makeQuery(table: string) {
    const filters: Array<{ column: string; value: unknown }> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "gte", "order", "limit"]) {
      q[m] = () => q;
    }
    q.eq = (column: string, value: unknown) => {
      filters.push({ column, value });
      eqCalls.push({ table, column, value });
      return q;
    };
    q.maybeSingle = async () => ({ data: { id: "user-uuid-1" } });
    q.single = async () => ({ data: { id: "user-uuid-1" } });
    q.then = (resolve: (v: unknown) => void) => {
      const keyedOnClerkId = filters.some(
        (f) => f.column === "user_id" && f.value === "clerk-user-1",
      );
      const count =
        table === "action_runs"
          ? keyedOnClerkId
            ? 3
            : 0
          : (rows[table] ?? []).length;
      resolve({ data: rows[table] ?? [], count });
    };
    return q;
  }

  const fakeAdmin = {
    from: (table: string) => {
      tablesQueried.push(table);
      return makeQuery(table);
    },
    rpc: async () => ({ data: [{ total: 2080 }] }),
  };

  return { tablesQueried, eqCalls, fakeAdmin };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "clerk-user-1" })),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: fakeAdmin,
}));

describe("GET /api/litt/usage", () => {
  beforeEach(() => {
    tablesQueried.length = 0;
    eqCalls.length = 0;
  });

  it("aggregates model usage from usage_events, never the dead model_usage table", async () => {
    const url = "https://x.test/api/litt/usage?range=month";
    const req = new Request(url);
    Object.assign(req, { nextUrl: new URL(url) });
    const res = await GET(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(tablesQueried).toContain("usage_events");
    expect(tablesQueried).not.toContain("model_usage");

    const byModel = new Map(body.modelUsage.map((m: { model: string }) => [m.model, m]));
    expect(byModel.get("gemini-x")).toMatchObject({ calls: 2, tokens: 430 });
    expect(byModel.get("gpt-y")).toMatchObject({ calls: 1, tokens: 15 });

    // Ledger summaries keep their established sources/semantics.
    expect(body.summary.totalCreditsUsed).toBe(150);
    expect(body.summary.totalCreditsRefunded).toBe(10);
    // "Agent runs" counts BOTH run stores: agent_runs (marketplace-agent
    // reservations, 2 rows above) + action_runs (built-in Studio runs,
    // count 3 above). Reading agent_runs alone made the Settings "Agent
    // runs" row permanently 0 for Studio-only users.
    expect(tablesQueried).toContain("action_runs");
    // The action_runs count must key on the CLERK id — that is the
    // identity stamped into action_runs.user_id by the run store. Keying
    // it on the internal users.id uuid (correct for the other tables)
    // matched zero rows in production even after the count was added.
    expect(eqCalls).toContainEqual({
      table: "action_runs",
      column: "user_id",
      value: "clerk-user-1",
    });
    expect(eqCalls).not.toContainEqual({
      table: "action_runs",
      column: "user_id",
      value: "user-uuid-1",
    });
    expect(body.summary.totalRuns).toBe(5);
    expect(body.balance).toBe(2080);
  });
});
