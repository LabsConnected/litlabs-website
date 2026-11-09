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
            // The real DB assigns gen_random_uuid() on insert when the row
            // carries no id — the fake must too, or inserted-row identity
            // (pausedRunId references) is undefined.
            const row = { id: `paused-${rows.length + 1}`, ...payload };
            row.id = (payload.id as string | undefined) ?? (row.id as string);
            rows.push(row);
            return { data: row, error: null };
          }
          const result = run();
          return { data: result[0] ?? null, error: null };
        },
        async single() {
          if (mode === "insert" && payload) {
            const row = { id: `paused-${rows.length + 1}`, ...payload };
            row.id = (payload.id as string | undefined) ?? (row.id as string);
            rows.push(row);
            return { data: row, error: null };
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

/** Minimal action_runs fake — enough surface for the expiry settle and
 *  re-request parent-attach paths under test. */
type FakeRun = {
  id: string;
  user_id: string;
  project_id: string | null;
  conversation_id: string | null;
  kind: string;
  status: string;
  approval_reference: string | null;
  failure_code: string | null;
  failure_message: string | null;
  current_activity: string | null;
  started_at: string | null;
  completed_at: string | null;
};

const runRows: FakeRun[] = [];

function fakeRun(overrides: Partial<FakeRun> = {}): FakeRun {
  const run: FakeRun = {
    id: `run-${runRows.length + 1}`,
    user_id: "user_1",
    project_id: "proj_1",
    conversation_id: "conv_1",
    kind: "agent",
    status: "waiting_for_user",
    approval_reference: null,
    failure_code: null,
    failure_message: null,
    current_activity: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
  runRows.push(run);
  return run;
}

vi.mock("@/lib/action-runtime", () => ({
  isTerminalActionRunStatus: (status: string) =>
    status === "completed" || status === "failed" || status === "cancelled",
  getActionRun: async (runId: string, userId: string) => {
    const r = runRows.find((row) => row.id === runId && row.user_id === userId);
    return r
      ? {
          id: r.id,
          status: r.status,
          approvalReference: r.approval_reference,
          failureCode: r.failure_code,
          failureMessage: r.failure_message,
          currentActivity: r.current_activity,
          startedAt: r.started_at,
          completedAt: r.completed_at,
        }
      : null;
  },
  createActionRun: async (input: {
    userId: string;
    projectId?: string | null;
    conversationId?: string | null;
    kind: string;
    currentActivity?: string;
  }) => {
    const run = fakeRun({
      user_id: input.userId,
      project_id: input.projectId ?? null,
      conversation_id: input.conversationId ?? null,
      kind: input.kind,
      status: "queued",
      current_activity: input.currentActivity ?? null,
    });
    return { id: run.id, status: run.status };
  },
  patchActionRun: async (
    runId: string,
    userId: string,
    patch: { approvalReference?: string | null; currentActivity?: string | null },
  ) => {
    const r = runRows.find((row) => row.id === runId && row.user_id === userId);
    if (!r) throw new Error("Action run not found");
    if (patch.approvalReference !== undefined) r.approval_reference = patch.approvalReference;
    if (patch.currentActivity !== undefined) r.current_activity = patch.currentActivity;
    return { id: r.id, status: r.status };
  },
  transitionActionRun: async (
    runId: string,
    userId: string,
    status: string,
    patch: Record<string, unknown> = {},
  ) => {
    const r = runRows.find((row) => row.id === runId && row.user_id === userId);
    if (!r) throw new Error("Action run not found");
    if (r.status === "completed" || r.status === "failed" || r.status === "cancelled") {
      throw new Error("Terminal action runs cannot be mutated");
    }
    r.status = status;
    if (patch.approvalReference !== undefined) r.approval_reference = patch.approvalReference as string | null;
    if (patch.currentActivity !== undefined) r.current_activity = patch.currentActivity as string | null;
    if (patch.failureCode !== undefined) r.failure_code = patch.failureCode as string | null;
    if (patch.failureMessage !== undefined) r.failure_message = patch.failureMessage as string | null;
    if (status === "cancelled" || status === "failed" || status === "completed") {
      r.completed_at = new Date().toISOString();
    }
    return { id: r.id, status: r.status };
  },
  listActionEvents: async () => [],
}));

import {
  getPausedRun,
  getPendingPausedRunForConversation,
  getLatestPausedRunForConversation,
  listPausedRunsForActionRun,
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

describe("paused-run-store — 30-minute approval TTL (2026-09-18)", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("APPROVAL_TTL is 30 minutes", async () => {
    const { APPROVAL_TTL } = await import("@/lib/litt-intelligence/paused-run-store");
    expect(APPROVAL_TTL).toBe(30 * 60 * 1000);
  });

  it("new paused runs get a ~30-minute expiry", async () => {
    const { createPausedRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const before = Date.now();
    const rec = await createPausedRun({
      userId: USER,
      conversationId: CONV,
      projectId: "proj_1",
      workspaceId: "ws_1",
      toolId: "files.write",
      toolCallId: "tc_ttl",
      inputs: { path: "a.txt" },
      reason: "Mutation requires approval",
      pausedMessages: [],
      executionMode: "act",
      systemPrompt: "sys",
      checkpointId: null,
    });
    const ttlMs = Date.parse(rec.expiresAt) - before;
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000 + 5_000);
  });
});

describe("paused-run-store — reconciler recency rule (2026-09-18)", () => {
  it("attributes a run created after the message", async () => {
    const { pausedRunBelongsToMessage } = await import("@/lib/litt-intelligence/paused-run-store");
    const msgAt = new Date("2026-09-18T10:58:00.000Z").toISOString();
    const runAt = new Date("2026-09-18T10:58:30.000Z").toISOString();
    expect(pausedRunBelongsToMessage(runAt, msgAt)).toBe(true);
  });

  it("tolerates a run created seconds before the message (clock skew)", async () => {
    const { pausedRunBelongsToMessage } = await import("@/lib/litt-intelligence/paused-run-store");
    const msgAt = new Date("2026-09-18T10:58:00.000Z").toISOString();
    const runAt = new Date("2026-09-18T10:57:30.000Z").toISOString();
    expect(pausedRunBelongsToMessage(runAt, msgAt)).toBe(true);
  });

  it("REJECTS a stale run from the conversation's history (the production defect)", async () => {
    const { pausedRunBelongsToMessage } = await import("@/lib/litt-intelligence/paused-run-store");
    // An approval that expired yesterday cannot be the gate for a message
    // created seconds ago — this misattribution is what told Larry an
    // approval "expired before a decision was made" within the same minute.
    const staleRunAt = new Date("2026-09-17T09:00:00.000Z").toISOString();
    const freshMsgAt = new Date("2026-09-18T10:58:00.000Z").toISOString();
    expect(pausedRunBelongsToMessage(staleRunAt, freshMsgAt)).toBe(false);
  });

  it("rejects a run more than the tolerance before the message", async () => {
    const { pausedRunBelongsToMessage } = await import("@/lib/litt-intelligence/paused-run-store");
    const msgAt = new Date("2026-09-18T10:58:00.000Z").toISOString();
    const runAt = new Date("2026-09-18T10:56:59.000Z").toISOString(); // 61s before
    expect(pausedRunBelongsToMessage(runAt, msgAt)).toBe(false);
  });

  it("returns false when the run timestamp is missing", async () => {
    const { pausedRunBelongsToMessage } = await import("@/lib/litt-intelligence/paused-run-store");
    expect(pausedRunBelongsToMessage(null, new Date().toISOString())).toBe(false);
    expect(pausedRunBelongsToMessage(undefined, new Date().toISOString())).toBe(false);
  });

  it("keeps the old behavior when the message timestamp is missing or unparseable", async () => {
    const { pausedRunBelongsToMessage } = await import("@/lib/litt-intelligence/paused-run-store");
    const runAt = new Date().toISOString();
    expect(pausedRunBelongsToMessage(runAt, null)).toBe(true);
    expect(pausedRunBelongsToMessage(runAt, "not-a-date")).toBe(true);
  });
});

describe("paused-run-store — reRequestExpiredRun (2026-09-18)", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("re-issues an expired gate as a fresh pending run with identical inputs", async () => {
    const { reRequestExpiredRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const expired = seedRow({
      status: "expired",
      tool_id: "files.write",
      tool_call_id: "tc_9",
      inputs: { path: "a.txt", content: "hello" },
      reason: "Mutation requires approval",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const fresh = await reRequestExpiredRun(expired.id as string, USER);
    expect(fresh).not.toBeNull();
    expect(fresh!.id).not.toBe(expired.id);
    expect(fresh!.status).toBe("pending");
    expect(fresh!.toolId).toBe("files.write");
    expect(fresh!.toolCallId).toBe("tc_9");
    expect(fresh!.inputs).toEqual({ path: "a.txt", content: "hello" });
    expect(fresh!.reason).toBe("Mutation requires approval");
    expect(fresh!.conversationId).toBe(CONV);
    // Fresh TTL — ~30 minutes, not the dead expiry
    expect(Date.parse(fresh!.expiresAt) - Date.now()).toBeGreaterThan(29 * 60 * 1000);
  });

  it("refuses to re-request a still-pending run", async () => {
    const { reRequestExpiredRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const pending = seedRow({ status: "pending" });
    expect(await reRequestExpiredRun(pending.id as string, USER)).toBeNull();
    // No duplicate row created
    expect(rows.length).toBe(1);
  });

  it("refuses to re-request approved/rejected runs", async () => {
    const { reRequestExpiredRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const approved = seedRow({ status: "approved" });
    const rejected = seedRow({ status: "rejected" });
    expect(await reRequestExpiredRun(approved.id as string, USER)).toBeNull();
    expect(await reRequestExpiredRun(rejected.id as string, USER)).toBeNull();
    expect(rows.length).toBe(2);
  });

  it("returns null for an unknown run or another user's run", async () => {
    const { reRequestExpiredRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const other = seedRow({ status: "expired", user_id: "user_2" });
    expect(await reRequestExpiredRun("nope", USER)).toBeNull();
    expect(await reRequestExpiredRun(other.id as string, USER)).toBeNull();
    expect(rows.length).toBe(1);
  });
});

describe("paused-run-store — expired gate settles the parked run", () => {
  beforeEach(() => {
    rows.length = 0;
    runRows.length = 0;
  });

  it("cancels a run still parked on a gate read as expired", async () => {
    // The 2026-11 stall: a gate that outlived its TTL left the parent run
    // waiting_for_user forever — badge "working", "Run in progress", Idle.
    const row = seedRow({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      action_run_id: "run-parked",
    });
    const run = fakeRun({ id: "run-parked", approval_reference: row.id as string });

    const record = await getPausedRun(row.id as string, USER);

    expect(record?.status).toBe("expired");
    expect(run.status).toBe("cancelled");
    expect(run.failure_code).toBe("APPROVAL_EXPIRED");
    expect(run.failure_message).toBe("Approval expired before a decision was made");
    expect(run.approval_reference).toBeNull();
  });

  it("settles a gate that is already durable-expired (resolve-path expiry)", async () => {
    // resolvePausedRun flips decision-past-TTL rows to expired without the
    // lazy flip — the settle must still fire on the next read.
    const row = seedRow({ status: "expired", action_run_id: "run-parked" });
    const run = fakeRun({ id: "run-parked", approval_reference: row.id as string });

    await getPausedRun(row.id as string, USER);
    expect(run.status).toBe("cancelled");
  });

  it("never cancels a run parked on a DIFFERENT gate (nested handoff)", async () => {
    const row = seedRow({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      action_run_id: "run-parked",
    });
    const run = fakeRun({ id: "run-parked", approval_reference: "other-gate" });

    const record = await getPausedRun(row.id as string, USER);
    expect(record?.status).toBe("expired");
    // The run moved on to a newer gate — an old gate's TTL must not kill it.
    expect(run.status).toBe("waiting_for_user");
  });

  it("leaves a terminal parent untouched", async () => {
    seedRow({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      action_run_id: "run-done",
    });
    const run = fakeRun({ id: "run-done", status: "completed" });

    await listPausedRunsForActionRun("run-done", USER);
    expect(run.status).toBe("completed");
  });

  it("a past-TTL decision ALSO settles the parked run", async () => {
    const row = seedRow({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
      action_run_id: "run-parked",
    });
    const run = fakeRun({ id: "run-parked", approval_reference: row.id as string });

    const resolved = await resolvePausedRun(row.id as string, USER, "approved");
    expect(resolved).toBeNull();
    expect(run.status).toBe("cancelled");
    expect(run.failure_code).toBe("APPROVAL_EXPIRED");
  });
});

describe("paused-run-store — re-request attaches a live canonical parent", () => {
  beforeEach(() => {
    rows.length = 0;
    runRows.length = 0;
  });

  it("mints a fresh run when the expired gate's run was settled", async () => {
    const { reRequestExpiredRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const expired = seedRow({
      status: "expired",
      action_run_id: "run-dead",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    fakeRun({ id: "run-dead", status: "cancelled", approval_reference: expired.id as string });

    const fresh = await reRequestExpiredRun(expired.id as string, USER);

    expect(fresh).not.toBeNull();
    // One run = one execution attempt: never repoint at the dead run, and
    // never leave the fresh gate parentless (approving it could not settle).
    expect(fresh!.actionRunId).not.toBe("run-dead");
    expect(fresh!.actionRunId).toBeTruthy();
    const minted = runRows.find((r) => r.id === fresh!.actionRunId);
    expect(minted?.status).toBe("queued");
    // The new run records WHICH gate it parks on — the expiry settle can
    // find and cancel this wait if the fresh TTL lapses too.
    expect(minted?.approval_reference).toBe(fresh!.id);
  });

  it("mints a fresh parent for a legacy gate with no action_run_id", async () => {
    const { reRequestExpiredRun } = await import("@/lib/litt-intelligence/paused-run-store");
    const expired = seedRow({
      status: "expired",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const fresh = await reRequestExpiredRun(expired.id as string, USER);
    expect(fresh!.actionRunId).toBeTruthy();
    expect(runRows.some((r) => r.id === fresh!.actionRunId)).toBe(true);
  });
});
