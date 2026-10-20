// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test — a rejected gate's settled record is readable
 * (Repair R3, Diagnosis E4-R4).
 *
 * The approvals route's rejection settle now carries a RunResult (with
 * the settle-time workspace verdict) on its approval.rejected event.
 * The derived-outcome reader must surface that result for the gate —
 * before the fix it skipped approval.rejected events entirely, so a
 * rejection's record derived to runResult: null and the verdict the
 * settle computed was invisible to every poll/GET/watcher consumer.
 * Historical rejection events (no result payload) keep deriving to
 * null exactly as before.
 */

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: null }));
vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(),
  listActionEvents: vi.fn(),
  isTerminalActionRunStatus: (status: string) => ["completed", "failed", "cancelled"].includes(status),
}));

import { getActionRun, listActionEvents } from "@/lib/action-runtime";
import { getRunOutcomeForPausedRun, type PausedRunRecord } from "../paused-run-store";

const VERDICT = { status: "changed", files: ["index.html"] };

describe("getRunOutcomeForPausedRun — rejected gate verdict (R3/E4-R4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces the rejection settle's runResult (with its verdict) for the gate", async () => {
    vi.mocked(getActionRun).mockResolvedValue({
      status: "cancelled",
      startedAt: "2026-10-20T00:00:01.000Z",
      completedAt: "2026-10-20T00:00:02.000Z",
      failureMessage: null,
    } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      {
        type: "approval.rejected",
        payload: {
          pausedRunId: "gate-1",
          result: {
            finalText: "",
            stepsUsed: 2,
            toolCalls: [],
            cancelled: true,
            workspaceChange: VERDICT,
          },
        },
      },
    ] as never);

    const outcome = await getRunOutcomeForPausedRun(
      { id: "gate-1", actionRunId: "run-1" } as PausedRunRecord,
      "owner",
    );

    expect(outcome.runResult?.workspaceChange).toEqual(VERDICT);
  });

  it("historical rejection events without a result still derive to a null runResult", async () => {
    vi.mocked(getActionRun).mockResolvedValue({
      status: "cancelled",
      startedAt: "2026-10-20T00:00:01.000Z",
      completedAt: "2026-10-20T00:00:02.000Z",
      failureMessage: null,
    } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.rejected", payload: { pausedRunId: "gate-1" } },
    ] as never);

    const outcome = await getRunOutcomeForPausedRun(
      { id: "gate-1", actionRunId: "run-1" } as PausedRunRecord,
      "owner",
    );

    expect(outcome.runResult).toBeNull();
  });

  it("never attributes another gate's rejection verdict to this gate", async () => {
    vi.mocked(getActionRun).mockResolvedValue({
      status: "cancelled",
      startedAt: "2026-10-20T00:00:01.000Z",
      completedAt: "2026-10-20T00:00:02.000Z",
      failureMessage: null,
    } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      {
        type: "approval.rejected",
        payload: {
          pausedRunId: "gate-2",
          result: { finalText: "", stepsUsed: 0, toolCalls: [], cancelled: true, workspaceChange: VERDICT },
        },
      },
    ] as never);

    const outcome = await getRunOutcomeForPausedRun(
      { id: "gate-1", actionRunId: "run-1" } as PausedRunRecord,
      "owner",
    );

    expect(outcome.runResult).toBeNull();
  });
});
