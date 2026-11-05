// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: null }));
vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(), listActionEvents: vi.fn(),
  isTerminalActionRunStatus: (status: string) => ["completed", "failed", "cancelled"].includes(status),
}));
import { getActionRun, listActionEvents } from "@/lib/action-runtime";
import { getRunOutcomeForPausedRun, type PausedRunRecord } from "../paused-run-store";
describe("approval outcome identity", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns the requested gate's handoff instead of a newer gate outcome", async () => {
    vi.mocked(getActionRun).mockResolvedValue({ status: "waiting_for_user" } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.required", payload: { pausedRunId: "gate-1", result: { pendingApproval: { pausedRunId: "gate-2" } } } },
      { type: "approval.required", payload: { pausedRunId: "gate-2", result: { pendingApproval: { pausedRunId: "gate-3" } } } },
    ] as never);
    const result = await getRunOutcomeForPausedRun({ id: "gate-1", actionRunId: "run" } as PausedRunRecord, "owner");
    expect(result.runResult?.pendingApproval?.pausedRunId).toBe("gate-2");
  });
  it("does not attribute a later gate's terminal result to a still-processing gate", async () => {
    vi.mocked(getActionRun).mockResolvedValue({ status: "working" } as never);
    vi.mocked(listActionEvents).mockResolvedValue([{ type: "run.completed", payload: { pausedRunId: "another", result: { finalText: "different operation" } } }] as never);
    const result = await getRunOutcomeForPausedRun({ id: "gate-1", actionRunId: "run" } as PausedRunRecord, "owner");
    expect(result.runStatus).toBe("processing");
    expect(result.runResult).toBeNull();
  });

  it("a pendingApproval handoff without a persisted pausedRunId is failed, never completed", async () => {
    // Production defect (golden run 41963302209): the derived outcome
    // reported "completed" with a pendingApproval whose pausedRunId was
    // never persisted — a dead card the client could never action.
    vi.mocked(getActionRun).mockResolvedValue({ status: "waiting_for_user" } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.required", payload: { pausedRunId: "gate-1", result: { pendingApproval: { toolId: "files.write" } } } },
    ] as never);
    const result = await getRunOutcomeForPausedRun({ id: "gate-1", actionRunId: "run" } as PausedRunRecord, "owner");
    expect(result.runStatus).toBe("failed");
    expect(result.runResult).toBeNull();
    expect(result.runError).toContain("approval gate was not persisted");
  });

  it("a pendingApproval handoff with neither toolId nor pausedRunId is failed", async () => {
    vi.mocked(getActionRun).mockResolvedValue({ status: "waiting_for_user" } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.required", payload: { pausedRunId: "gate-1", result: { pendingApproval: { reason: "Approval required" } } } },
    ] as never);
    const result = await getRunOutcomeForPausedRun({ id: "gate-1", actionRunId: "run" } as PausedRunRecord, "owner");
    expect(result.runStatus).toBe("failed");
  });

  it("a valid nested handoff (toolId + persisted pausedRunId) still completes", async () => {
    vi.mocked(getActionRun).mockResolvedValue({ status: "waiting_for_user" } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      {
        type: "approval.required",
        payload: {
          pausedRunId: "gate-1",
          result: { pendingApproval: { toolId: "files.write", pausedRunId: "gate-2", reason: "Mutation requires approval" } },
        },
      },
    ] as never);
    const result = await getRunOutcomeForPausedRun({ id: "gate-1", actionRunId: "run" } as PausedRunRecord, "owner");
    expect(result.runStatus).toBe("completed");
    expect(result.runResult?.pendingApproval?.pausedRunId).toBe("gate-2");
  });

  it("a repeated pause chain resolves each gate's own handoff", async () => {
    // gate-1 paused → resumed → paused on gate-2 → resumed → completed.
    // Each gate's GET must see ITS handoff, not a sibling's.
    vi.mocked(getActionRun).mockResolvedValue({ status: "completed" } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.required", payload: { pausedRunId: "gate-1", result: { pendingApproval: { toolId: "files.write", pausedRunId: "gate-2" } } } },
      { type: "approval.required", payload: { pausedRunId: "gate-2", result: { pendingApproval: { toolId: "files.mkdir", pausedRunId: "gate-3" } } } },
      { type: "run.completed", payload: { pausedRunId: "gate-3", result: { finalText: "done" } } },
    ] as never);
    const g1 = await getRunOutcomeForPausedRun({ id: "gate-1", actionRunId: "run" } as PausedRunRecord, "owner");
    const g2 = await getRunOutcomeForPausedRun({ id: "gate-2", actionRunId: "run" } as PausedRunRecord, "owner");
    const g3 = await getRunOutcomeForPausedRun({ id: "gate-3", actionRunId: "run" } as PausedRunRecord, "owner");
    expect(g1.runResult?.pendingApproval?.pausedRunId).toBe("gate-2");
    expect(g2.runResult?.pendingApproval?.pausedRunId).toBe("gate-3");
    expect(g3.runResult?.finalText).toBe("done");
  });
});
