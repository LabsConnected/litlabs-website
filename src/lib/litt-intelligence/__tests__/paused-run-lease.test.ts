// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Resumed-run durability tests: lease, progress signal, fencing token.
 *
 * The production defect (2026-09-19 acceptance): a resumed approval run
 * doing legitimate work — image generated, mid file-writes — was marked
 * failed by the read-side stale detector at exactly 10 minutes, the same
 * constant as the agent loop's own maxRuntimeMs budget. Age was the only
 * liveness signal, the kill did not actually stop the executor, and the
 * executor's unconditional terminal write could silently overwrite the
 * recorded failure (or a retry could spawn a second mutating executor
 * alongside it).
 *
 * These tests pin the lease semantics that replaced blind age:
 *   - a live executor working past the old 10-minute wall is never condemned
 *   - a dead executor's lease lapses and the run is failed fast (≤90s)
 *   - a live-but-wedged executor is failed on the progress deadline, not age
 *   - fenced terminal writes cannot overwrite another owner's truth
 *   - retry is only allowed once the old executor provably died
 *   - durable gate state (deferred calls, counters, identity) survives
 *     fail → reset → re-claim, which is what makes a post-restart re-drive
 *     replay idempotent effects instead of duplicating them
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
  markRunProcessing,
  markRunCompleted,
  markRunFailed,
  renewRunLease,
  resetRunForRetry,
  RUN_LEASE_MS,
  RUN_STALL_MS,
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

const RESULT = {
  finalText: "done",
  stepsUsed: 3,
  toolCalls: [],
  cancelled: false,
};

describe("resumed-run lease — liveness replaces age", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("a run actively working past the old 10-minute wall is NOT marked failed (the production defect)", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(15), // older than the legacy 10-min wall
      execution_token: "tok-1",
      lease_expires_at: msFromNow(60_000),
      last_progress_at: minsAgo(1),
    });

    const rec = await getPausedRun(row.id as string, USER);
    expect(rec?.runStatus).toBe("processing");
    expect(row.run_status).toBe("processing");
    expect(row.run_error).toBeNull();
  });

  it("a dead executor (lease lapsed) is marked failed fast — provably gone, no 10-min wait", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(4),
      execution_token: "tok-1",
      lease_expires_at: minsAgo(0.5), // heartbeats stopped ~30s ago
      last_progress_at: minsAgo(2),
    });

    const rec = await getPausedRun(row.id as string, USER);
    expect(rec?.runStatus).toBe("failed");
    expect(rec?.runError).toContain("worker may have restarted");
    expect(row.run_status).toBe("failed");
    expect(row.run_completed_at).toBeTruthy();
  });

  it("a live-but-wedged executor (fresh lease, frozen progress) is marked failed as a genuine stall", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(15),
      execution_token: "tok-1",
      lease_expires_at: msFromNow(60_000), // process alive, still beating
      last_progress_at: minsAgo(13), // but nothing has happened for >12 min
    });

    const rec = await getPausedRun(row.id as string, USER);
    expect(rec?.runStatus).toBe("failed");
    expect(rec?.runError).toContain("stalled");
    expect(row.run_status).toBe("failed");
  });

  it("a stalled run with fresh progress inside the window is left alone", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(11),
      execution_token: "tok-1",
      lease_expires_at: msFromNow(60_000),
      last_progress_at: minsAgo(RUN_STALL_MS / 60_000 - 2), // within the window
    });

    const rec = await getPausedRun(row.id as string, USER);
    expect(rec?.runStatus).toBe("processing");
  });

  it("a pre-lease row (claimed before this migration, e.g. mid-deploy) still falls back to the age rule", async () => {
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(15),
      // no lease fields — legacy claim
    });

    const rec = await getPausedRun(row.id as string, USER);
    expect(rec?.runStatus).toBe("failed");
    expect(rec?.runError).toContain("process may have restarted");
  });
});

describe("resumed-run lease — claim, heartbeat, fencing", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("markRunProcessing claims atomically and mints token + lease + progress", async () => {
    const row = seedRow();
    const ok = await markRunProcessing(row.id as string, USER, "tok-1");

    expect(ok).toBe(true);
    expect(row.run_status).toBe("processing");
    expect(row.execution_token).toBe("tok-1");
    expect(row.last_progress_at).toBeTruthy();
    const leaseMs = Date.parse(row.lease_expires_at as string) - Date.now();
    expect(leaseMs).toBeGreaterThan(RUN_LEASE_MS - 5_000);
    expect(leaseMs).toBeLessThanOrEqual(RUN_LEASE_MS);

    // Duplicate resume prevention: a second claim is refused.
    expect(await markRunProcessing(row.id as string, USER, "tok-2")).toBe(false);
    expect(row.execution_token).toBe("tok-1");
  });

  it("renewRunLease extends the lease and carries the executor's progress timestamp", async () => {
    const row = seedRow();
    await markRunProcessing(row.id as string, USER, "tok-1");
    const progressAt = new Date().toISOString();

    const alive = await renewRunLease(row.id as string, USER, "tok-1", progressAt);
    expect(alive).toBe(true);
    expect(row.last_progress_at).toBe(progressAt);
    expect(Date.parse(row.lease_expires_at as string)).toBeGreaterThan(
      Date.now() + RUN_LEASE_MS - 5_000,
    );
  });

  it("renewRunLease reports fenced — wrong token or lost claim — so the executor aborts", async () => {
    const row = seedRow();
    await markRunProcessing(row.id as string, USER, "tok-1");

    // A superseded executor's token no longer matches.
    expect(await renewRunLease(row.id as string, USER, "tok-stale", "p")).toBe(false);

    // Once the run is terminal (e.g. stall-marked), even the right token is fenced.
    row.run_status = "failed";
    expect(await renewRunLease(row.id as string, USER, "tok-1", "p")).toBe(false);
  });

  it("a fenced executor cannot overwrite terminal truth when it finally finishes", async () => {
    const row = seedRow();
    await markRunProcessing(row.id as string, USER, "tok-1");

    // The stale detector marks the run failed mid-flight (lease lapsed in
    // this simulated world), then the zombie finishes and tries to write.
    row.run_status = "failed";
    row.run_error = "Execution lost (worker may have restarted)";

    const wrote = await markRunCompleted(row.id as string, USER, RESULT, "tok-1");
    expect(wrote).toBe(false);
    expect(row.run_status).toBe("failed");
    expect(row.run_result).toBeNull();
  });

  it("markRunCompleted lands only while the token owns a live claim", async () => {
    const row = seedRow();
    await markRunProcessing(row.id as string, USER, "tok-1");

    const wrote = await markRunCompleted(row.id as string, USER, RESULT, "tok-1");
    expect(wrote).toBe(true);
    expect(row.run_status).toBe("completed");
    expect(row.run_result).toEqual(RESULT);
  });

  it("a zombie that outlives a retry cannot clobber the new claim's outcome", async () => {
    const row = seedRow();
    await markRunProcessing(row.id as string, USER, "tok-1");

    // tok-1 dies (lease lapsed, detector failed the run), retry re-claims.
    row.run_status = "failed";
    row.lease_expires_at = minsAgo(1);
    expect(await resetRunForRetry(row.id as string, USER)).toBe(true);
    await markRunProcessing(row.id as string, USER, "tok-2");

    // The zombie's late terminal write is fenced by token mismatch...
    expect(await markRunCompleted(row.id as string, USER, RESULT, "tok-1")).toBe(false);
    expect(row.run_status).toBe("processing");
    // ...and the new owner's write lands.
    expect(await markRunCompleted(row.id as string, USER, RESULT, "tok-2")).toBe(true);
    expect(row.run_status).toBe("completed");
  });
});

describe("resumed-run lease — retry only after proven death", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("resetRunForRetry refuses while the failed run's lease is still fresh", async () => {
    const row = seedRow({
      run_status: "failed",
      run_error: "Execution stalled (no progress)",
      execution_token: "tok-1",
      lease_expires_at: msFromNow(60_000), // executor may still be tearing down
      last_progress_at: minsAgo(13),
    });

    expect(await resetRunForRetry(row.id as string, USER)).toBe(false);
    expect(row.run_status).toBe("failed");
  });

  it("resetRunForRetry allows once the lease has lapsed and clears claim fields", async () => {
    const row = seedRow({
      run_status: "failed",
      run_error: "Execution lost (worker may have restarted)",
      execution_token: "tok-1",
      lease_expires_at: minsAgo(1),
      last_progress_at: minsAgo(3),
    });

    expect(await resetRunForRetry(row.id as string, USER)).toBe(true);
    expect(row.run_status).toBeNull();
    expect(row.execution_token).toBeNull();
    expect(row.lease_expires_at).toBeNull();
    expect(row.last_progress_at).toBeNull();
    expect(row.status).toBe("approved"); // the grant itself is untouched
  });

  it("legacy failed runs (no lease) still retry under the old contract", async () => {
    const row = seedRow({
      run_status: "failed",
      run_error: "The approved workspace operation failed",
    });
    expect(await resetRunForRetry(row.id as string, USER)).toBe(true);
  });
});

describe("resumed-run durability — durable gate state survives re-drive", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("deferred calls, step counters, and the record identity survive fail → reset → re-claim", async () => {
    const deferred = [
      { toolCallId: "tc_2", toolId: "files.write", inputs: { path: "b.html" } },
      { toolCallId: "tc_3", toolId: "project.deploy", inputs: {} },
    ];
    const row = seedRow({
      run_status: "processing",
      run_started_at: minsAgo(6),
      execution_token: "tok-1",
      lease_expires_at: minsAgo(1),
      last_progress_at: minsAgo(3),
      deferred_tool_calls: deferred,
      steps_used: 4,
      had_intervening_mutation: true,
    });

    // Detector fails the dead run; operator/user retries.
    await getPausedRun(row.id as string, USER);
    expect(row.run_status).toBe("failed");
    expect(await resetRunForRetry(row.id as string, USER)).toBe(true);
    await markRunProcessing(row.id as string, USER, "tok-2");

    // The durable checkpoint is intact: the re-driven run resumes the SAME
    // approval record — same id (the billing requestId `approval:<id>` is
    // therefore stable → provider replay, no second debit; see
    // image-service.test.ts replay/idempotency coverage).
    expect(row.id).toBeTruthy();
    expect(row.deferred_tool_calls).toEqual(deferred);
    expect(row.steps_used).toBe(4);
    expect(row.had_intervening_mutation).toBe(true);
    expect(row.status).toBe("approved");
    expect(row.execution_token).toBe("tok-2");
  });

  it("an executor failing itself keeps the run truthfully failed (token-fenced write)", async () => {
    const row = seedRow();
    await markRunProcessing(row.id as string, USER, "tok-1");

    await markRunFailed(row.id as string, USER, "boom", "tok-1");
    expect(row.run_status).toBe("failed");
    expect(row.run_error).toBe("boom");

    // A different token cannot flip it back.
    const wrote = await markRunCompleted(row.id as string, USER, RESULT, "tok-other");
    expect(wrote).toBe(false);
    expect(row.run_status).toBe("failed");
  });
});
