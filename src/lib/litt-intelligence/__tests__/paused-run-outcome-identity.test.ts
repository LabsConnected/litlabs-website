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
});
