import { describe, expect, it, vi } from "vitest";

/**
 * Regression test — the loop's cancelReason must carry the abort's actual
 * origin (Repair R4, Diagnosis E3-S1/S6).
 *
 * The defect: the agent loop hard-coded cancelReason = "Cancelled by
 * user" for ANY signal abort, never reading signal.reason. The graceful
 * shutdown routine aborts executions with its own reason ("Received
 * SIGTERM — shutting down Studio executions"); the loop rewrote that to
 * a user cancellation, and the settle sites downstream recorded a server
 * restart as the user pressing Stop. The deferred-batch abort check is
 * one of the sites; the main loops share the same helper.
 */

import {
  resumeAgentLoopV2,
  type ResumeInput,
} from "@/lib/litt-intelligence/agent-loop-v2";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

const SHUTDOWN_REASON = "Received SIGTERM — shutting down Studio executions";

describe("resumeAgentLoopV2 — abort origin propagation (R4/E3-S6)", () => {
  it("a shutdown-reason abort surfaces its real reason, not 'Cancelled by user'", async () => {
    const controller = new AbortController();
    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockImplementation(async () => {
        // Simulate the shutdown routine aborting the execution while the
        // approved call finishes — with the shutdown's own reason, the
        // way lib/studio/shutdown.ts aborts registry controllers.
        controller.abort(new Error(SHUTDOWN_REASON));
        return { ok: true, result: { success: true } };
      });

    const transport = {
      workspaceId: "ws-resume-abort-reason",
      userId: "u-resume-abort-reason",
      projectId: "p-resume-abort-reason",
      workspaceRoot: "/tmp/resume-abort-reason",
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceTransport;

    const resume: ResumeInput = {
      pausedMessages: [{ role: "user", content: "continue" }],
      toolId: "files.read",
      toolCallId: "approved-call",
      inputs: { path: "index.html" },
      decision: "approved",
      config: {
        executionMode: "auto",
        systemPrompt: "You are LiTT.",
        enableBuildFix: false,
        maxSteps: 5,
        maxRuntimeMs: 30_000,
        signal: controller.signal,
        actionContext: {
          actionRunId: "run-parent",
          userId: "u-resume-abort-reason",
          conversationId: "conv-resume",
          projectId: "p-resume-abort-reason",
        },
      },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
      deferredToolCalls: [
        {
          toolCallId: "deferred-call",
          toolId: "files.read",
          inputs: { path: "after-approval.html" },
        },
      ],
    };

    const result = await resumeAgentLoopV2(resume, transport);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    // Before the fix this read "Cancelled by user" — the shutdown's
    // reason was discarded at the loop and every downstream settle
    // recorded a deployment restart as a user cancellation.
    expect(result.cancelReason).toBe(SHUTDOWN_REASON);
    expect(result.cancelReason).not.toBe("Cancelled by user");
  });
});
