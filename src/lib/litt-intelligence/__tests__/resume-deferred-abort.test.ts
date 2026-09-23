import { describe, expect, it, vi } from "vitest";

import {
  resumeAgentLoopV2,
  type ResumeInput,
} from "@/lib/litt-intelligence/agent-loop-v2";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

describe("resumeAgentLoopV2 — deferred approval abort", () => {
  it("executes the approved call but zero deferred calls after the resume signal is aborted", async () => {
    const controller = new AbortController();
    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockImplementation(async () => {
        // Simulate the user pressing Stop while the approved call is finishing.
        // The deferred remainder must observe this same signal before starting.
        controller.abort();
        return { ok: true, result: { success: true } };
      });

    const transport = {
      workspaceId: "ws-resume-abort",
      userId: "u-resume-abort",
      projectId: "p-resume-abort",
      workspaceRoot: "/tmp/resume-abort",
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
          userId: "u-resume-abort",
          conversationId: "conv-resume",
          projectId: "p-resume-abort",
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

    // One registry execution is expected: the explicitly approved call.
    // The deferred call must never start once the shared signal is aborted.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0]?.[0]).toBe("files.read");
    expect(executeSpy.mock.calls[0]?.[2]).toMatchObject({
      actionContext: { actionRunId: "run-parent", userId: "u-resume-abort" },
    });
    expect(result.cancelled).toBe(true);
    expect(result.cancelReason).toBe("Cancelled by user");
    expect(result.toolCalls).toHaveLength(1);
  });
});
