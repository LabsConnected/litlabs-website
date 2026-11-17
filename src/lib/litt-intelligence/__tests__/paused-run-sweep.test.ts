// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Round 14 — the stale-run reaper gets a clock.
 *
 * recoverStaleRun's rules were already precise (lease lapse =
 * provable death, frozen progress = genuine stall, legacy age rule
 * for pre-lease rows), but it only ran when some READ touched the
 * run. The 2026-11-17 lion proof's approval card sat on "Approved —
 * running…" long after the run ended because nothing ever read the
 * gate again. sweepStaleRuns runs the same recovery periodically;
 * these tests pin that it recovers exactly the rows the read path
 * would — without any read — and leaves healthy rows untouched.
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
  sweepStaleRuns,
  startStaleRunSweeper,
  stopStaleRunSweeper,
} from "@/lib/litt-intelligence/paused-run-store";

const USER = "user_1";
const CONV = "conv_1";

function minsAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
function msFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

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
    action_run_id: null,
    status: "approved",
    created_at: minsAgo(20),
    expires_at: msFromNow(30 * 60_000),
    resolved_at: minsAgo(16),
    run_status: null,
    run_result: null,
    run_error: null,
    run_started_at: null,
    run_completed_at: null,
    execution_token: null,
    lease_expires_at: null,
    last_progress_at: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

describe("sweepStaleRuns (round 14)", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  afterEach(() => {
    stopStaleRunSweeper();
  });

  it("recovers a dead executor's run WITHOUT any read touching it", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(4),
      execution_token: "tok-1",
      lease_expires_at: minsAgo(0.5),
      last_progress_at: minsAgo(2),
    });

    const result = await sweepStaleRuns();

    expect(result.recoveredRuns).toBe(1);
    expect(row.run_status).toBe("failed");
    expect(String(row.run_error)).toContain("worker may have restarted");
    expect(row.run_completed_at).toBeTruthy();
  });

  it("leaves a healthy in-flight run untouched", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(15),
      execution_token: "tok-1",
      lease_expires_at: msFromNow(60_000),
      last_progress_at: minsAgo(1),
    });

    const result = await sweepStaleRuns();

    expect(result.recoveredRuns).toBe(0);
    expect(row.run_status).toBe("processing");
    expect(row.run_error).toBeNull();
  });

  it("recovers an approved run whose execution never started", async () => {
    const row = seedRow({
      run_status: null,
      resolved_at: minsAgo(16),
    });

    const result = await sweepStaleRuns();

    expect(result.recoveredRuns).toBe(1);
    expect(row.run_status).toBe("failed");
    expect(String(row.run_error)).toContain("never started");
  });

  it("recovers a live-but-wedged run (fresh lease, frozen progress)", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(15),
      execution_token: "tok-1",
      lease_expires_at: msFromNow(60_000),
      last_progress_at: minsAgo(13),
    });

    const result = await sweepStaleRuns();

    expect(result.recoveredRuns).toBe(1);
    expect(row.run_status).toBe("failed");
    expect(String(row.run_error)).toContain("stalled");
  });

  it("expires stale pending gates in the same pass", async () => {
    const row = seedRow({
      status: "pending",
      run_status: null,
      resolved_at: null,
      expires_at: minsAgo(1),
    });

    const result = await sweepStaleRuns();

    expect(result.expiredGates).toBe(1);
    expect(row.status).toBe("expired");
  });

  it("the sweeper starts once per process and stops cleanly", () => {
    expect(startStaleRunSweeper()).toBe(true);
    expect(startStaleRunSweeper()).toBe(false);
    stopStaleRunSweeper();
    expect(startStaleRunSweeper()).toBe(true);
  });
});
