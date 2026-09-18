// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for paused-run expiry truthfulness (P1 approval
 * lifecycle).
 *
 * The production defect: a paused approval that outlived its TTL without a
 * decision kept `status = "pending"` forever — `expireStaleRuns` existed
 * but was never called, and `getPausedRun` returned the row verbatim. The
 * GET /approvals endpoint therefore reported "pending" for dead gates, the
 * client watcher never settled, and the Approve/Reject card stayed mounted
 * with no path to converge.
 *
 * These tests verify:
 *   - getPausedRun lazily flips a pending-but-expired row to "expired" and
 *     persists it (so every reader — GET route, POST route, watcher —
 *     sees the truth)
 *   - getPendingPausedRunForConversation never returns an expired gate
 *   - getLatestPausedRunForConversation returns the newest row regardless
 *     of status (needed to reconcile a dead gate's transcript message)
 *   - resolvePausedRun still refuses decisions on expired gates
 */

type Row = Record<string, unknown>;

const rows: Row[] = [];

function applyFilters(collected: Row[], filters: Array<[string, string, unknown]>): Row[] {
  return collected.filter((r) =>
    filters.every(([col, op, val]) => {
      const v = r[col];
      switch (op) {
        case "eq": return v === val;
        case "gt": return typeof v === "string" && v > (val as string);
        case "lt": return typeof v === "string" && v < (val as string);
        case "is": return v === val;
        default: return true;
      }
    }),
  );
}

function makeDb() {
  return {
    from: () => {
      const filters: Array<[string, string, unknown]> = [];
      let mode: "select" | "insert" | "update" | null = null;
      let payload: Row | null = null;
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitN: number | null = null;

      const run = (): Row[] => {
        let result = applyFilters(rows, filters);
        if (mode === "update" && payload) {
          for (const r of result) Object.assign(r, payload);
        }
        if (orderCol) {
          result = [...result].sort((a, b) => {
            const cmp = String(a[orderCol!] ?? "").localeCompare(String(b[orderCol!] ?? ""));
            return orderAsc ? cmp : -cmp;
          });
        }
        if (limitN != null) result = result.slice(0, limitN);
        return result;
      };

      const chain: Record<string, unknown> & { then: Promise<{ data: unknown; error: null }>["then"] } = {
        select() { mode = mode ?? "select"; return chain; },
        insert(p: Row) { mode = "insert"; payload = p; return chain; },
        update(p: Row) { mode = "update"; payload = p; return chain; },
        eq(c: string, v: unknown) { filters.push([c, "eq", v]); return chain; },
        gt(c: string, v: unknown) { filters.push([c, "gt", v]); return chain; },
        lt(c: string, v: unknown) { filters.push([c, "lt", v]); return chain; },
        is(c: string, v: unknown) { filters.push([c, "is", v]); return chain; },
        order(c: string, o?: { ascending?: boolean }) { orderCol = c; orderAsc = o?.ascending ?? true; return chain; },
        limit(n: number) { limitN = n; return chain; },
        async maybeSingle() {
          if (mode === "insert" && payload) {
            rows.push(payload);
            return { data: payload, error: null };
          }
          const result = run();
          return { data: result[0] ?? null, error: null };
        },
        async single() {
          if (mode === "insert" && payload) {
            rows.push(payload);
            return { data: payload, error: null };
          }
          const result = run();
          return { data: result[0] ?? null, error: result[0] ? null : { message: "not found" } };
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data: run(), error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: makeDb(),
}));

import {
  getPausedRun,
  getPendingPausedRunForConversation,
  getLatestPausedRunForConversation,
  resolvePausedRun,
  resetRunForRetry,
} from "@/lib/litt-intelligence/paused-run-store";

const USER = "user_1";
const CONV = "conv_1";

function seedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: `paused-${rows.length + 1}`,
    user_id: USER,
    conversation_id: CONV,
    project_id: "proj_1",
    workspace_id: "ws_1",
    tool_id: "files.write",
    tool_call_id: "tc_1",
    inputs: {},
    reason: "Mutation requires approval",
    paused_messages: [],
    execution_mode: "act",
    system_prompt: "sys",
    checkpoint_id: null,
    status: "pending",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    resolved_at: null,
    run_status: null,
    run_result: null,
    run_error: null,
    run_started_at: null,
    run_completed_at: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

describe("paused-run-store — expiry truthfulness", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("getPausedRun reports a pending row past its TTL as expired — and persists it", async () => {
    const row = seedRow({ expires_at: new Date(Date.now() - 1_000).toISOString() });

    const record = await getPausedRun(row.id as string, USER);
    expect(record?.status).toBe("expired");
    // The flip is durable — a second read (and any other reader) sees it.
    expect(row.status).toBe("expired");
    expect(row.resolved_at).toBeTruthy();
  });

  it("getPausedRun leaves a live pending run untouched", async () => {
    const row = seedRow();
    const record = await getPausedRun(row.id as string, USER);
    expect(record?.status).toBe("pending");
    expect(row.status).toBe("pending");
  });

  it("getPendingPausedRunForConversation never returns an expired gate", async () => {
    seedRow({ expires_at: new Date(Date.now() - 1_000).toISOString() });
    const record = await getPendingPausedRunForConversation(CONV, USER);
    expect(record).toBeNull();
  });

  it("getLatestPausedRunForConversation returns the newest row regardless of status", async () => {
    seedRow({
      status: "expired",
      created_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() - 30_000).toISOString(),
    });
    seedRow({ status: "rejected", created_at: new Date().toISOString() });

    const latest = await getLatestPausedRunForConversation(CONV, USER);
    expect(latest?.status).toBe("rejected");
  });

  it("getLatestPausedRunForConversation reports pending-but-expired rows as expired", async () => {
    seedRow({ expires_at: new Date(Date.now() - 5_000).toISOString() });
    const latest = await getLatestPausedRunForConversation(CONV, USER);
    expect(latest?.status).toBe("expired");
  });

  it("getLatestPausedRunForConversation marks a stale processing run as failed — and persists it", async () => {
    // The detached resume was killed mid-flight (deploy/restart). Without
    // this recovery the transcript reconciler sees "processing" forever
    // and the dead approval card never converges.
    const row = seedRow({
      status: "approved",
      resolved_at: new Date(Date.now() - 15 * 60_000).toISOString(),
      run_status: "processing",
      run_started_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    });

    const latest = await getLatestPausedRunForConversation(CONV, USER);
    expect(latest?.runStatus).toBe("failed");
    expect(latest?.runError).toContain("process may have restarted");
    expect(row.run_status).toBe("failed");
    expect(row.run_completed_at).toBeTruthy();
  });

  it("getLatestPausedRunForConversation leaves a freshly-processing run alone", async () => {
    const row = seedRow({
      status: "approved",
      resolved_at: new Date(Date.now() - 30_000).toISOString(),
      run_status: "processing",
      run_started_at: new Date(Date.now() - 30_000).toISOString(),
    });

    const latest = await getLatestPausedRunForConversation(CONV, USER);
    expect(latest?.runStatus).toBe("processing");
    expect(row.run_status).toBe("processing");
  });

  it("getLatestPausedRunForConversation marks an approved run that never started as failed", async () => {
    // The process died between the atomic decision and markRunProcessing.
    const row = seedRow({
      status: "approved",
      resolved_at: new Date(Date.now() - 15 * 60_000).toISOString(),
      run_status: null,
      run_started_at: null,
    });

    const latest = await getLatestPausedRunForConversation(CONV, USER);
    expect(latest?.runStatus).toBe("failed");
    expect(row.run_status).toBe("failed");
  });

  it("resolvePausedRun refuses a decision on an expired gate", async () => {
    const row = seedRow({ expires_at: new Date(Date.now() - 1_000).toISOString() });
    const resolved = await resolvePausedRun(row.id as string, USER, "approved");
    expect(resolved).toBeNull();
    expect(row.status).toBe("expired");
  });
});

describe("paused-run-store — resetRunForRetry", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("resets an approved+failed run to the not-yet-started state and clears the error", async () => {
    const row = seedRow({
      status: "approved",
      run_status: "failed",
      run_error: "The approved workspace operation failed",
      run_completed_at: new Date().toISOString(),
    });

    const ok = await resetRunForRetry(row.id as string, USER);

    expect(ok).toBe(true);
    // Back to NULL (not-yet-started) so the resume route's markRunProcessing
    // claims the retried execution exactly like a fresh approval.
    expect(row.run_status).toBeNull();
    expect(row.run_error).toBeNull();
    expect(row.run_completed_at).toBeNull();
    // The approval decision itself is untouched — single-use still holds.
    expect(row.status).toBe("approved");
  });

  it("refuses a run that is still processing (no double execution)", async () => {
    const row = seedRow({ status: "approved", run_status: "processing" });
    expect(await resetRunForRetry(row.id as string, USER)).toBe(false);
    expect(row.run_status).toBe("processing");
  });

  it("refuses a completed run", async () => {
    const row = seedRow({ status: "approved", run_status: "completed" });
    expect(await resetRunForRetry(row.id as string, USER)).toBe(false);
    expect(row.run_status).toBe("completed");
  });

  it("refuses a pending (undecided) run — a retry is not a decision", async () => {
    const row = seedRow({ status: "pending", run_status: "failed" });
    expect(await resetRunForRetry(row.id as string, USER)).toBe(false);
    expect(row.run_status).toBe("failed");
  });

  it("refuses another user's run", async () => {
    const row = seedRow({
      status: "approved",
      run_status: "failed",
      user_id: "user_2",
    });
    expect(await resetRunForRetry(row.id as string, USER)).toBe(false);
    expect(row.run_status).toBe("failed");
  });
});
