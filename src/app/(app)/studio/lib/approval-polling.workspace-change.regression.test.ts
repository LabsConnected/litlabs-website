// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  submitApprovalAndPoll,
  watchApprovalResolution,
  type ApprovalRunResult,
} from "./approval-polling";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";

/**
 * Regression test — the client poll mapping carries the verdict
 * (Repair R3, Diagnosis E4-S5/R3).
 *
 * The settled runResult's workspaceChange must survive the trip from
 * the approvals GET payload through approval-polling's typed contract
 * to the outcome consumer, intact. Before the fix, ApprovalRunResult
 * had no workspaceChange field at all — the verdict existed (after the
 * server-side fix) on the wire but in no typed surface the client
 * could render, so it was dropped by contract.
 */

const VERDICT: WorkspaceChangeEvidence = {
  status: "changed",
  files: ["index.html"],
  rollbackAvailable: false,
};

const RUN_RESULT: ApprovalRunResult = {
  finalText: "done",
  stepsUsed: 5,
  toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
  cancelled: false,
  workspaceChange: VERDICT,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("approval polling — workspaceChange passthrough (R3/E4-R3)", () => {
  it("submitApprovalAndPoll delivers the settled verdict intact to onCompleted", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") {
        return jsonResponse(202, { resolved: true, status: "processing" });
      }
      return jsonResponse(200, {
        status: "approved",
        runStatus: "completed",
        runResult: RUN_RESULT,
        runError: null,
      });
    }) as unknown as typeof fetch;

    const onCompleted = vi.fn();
    await new Promise<void>((resolve, reject) => {
      submitApprovalAndPoll({
        conversationId: "conv-1",
        pausedRunId: "paused-1",
        decision: "approved",
        fetchImpl,
        sleep: async () => {},
        pollIntervalMs: 1,
        onCompleted: (result) => {
          try {
            expect(result.workspaceChange).toEqual(VERDICT);
            onCompleted(result);
            resolve();
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
        onFailed: (error) => reject(new Error(`unexpected onFailed: ${error}`)),
      });
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("watchApprovalResolution carries the verdict on its settled outcome", async () => {
    const onSettled = vi.fn();
    await new Promise<void>((resolve) => {
      watchApprovalResolution({
        conversationId: "conv-1",
        pausedRunId: "paused-1",
        pollIntervalMs: 1,
        sleep: async () => {},
        fetchStatus: async () => ({
          status: "approved",
          runStatus: "completed",
          runResult: RUN_RESULT,
          runError: null,
        }),
        onSettled: (outcome) => {
          onSettled(outcome);
          resolve();
        },
      });
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    const outcome = onSettled.mock.calls[0][0] as { runResult: ApprovalRunResult | null };
    expect(outcome.runResult?.workspaceChange).toEqual(VERDICT);
  });
});
