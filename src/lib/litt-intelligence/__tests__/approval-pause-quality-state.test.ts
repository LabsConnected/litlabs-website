/**
 * Round 8 — the approval pause must carry the quality session at the
 * TOP level of the loop result.
 *
 * The defect (live proof 2026-11-16, diagnosis Q1): both pause
 * returns in agent-loop-v2 set the session snapshot only inside
 * pendingApproval. The messages route persists a paused run from the
 * result's top-level qualityLoopState — the field the final return
 * populates — so every approval-paused run was written with
 * quality_loop_state=NULL. On resume the scope was re-derived from
 * prose (classifyTaskScope has no media case) and a media run came
 * back as "standard", where the build guard then failed it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "../agent-loop-v2";
import { callLLMWithTools } from "../llm-tool-calling";

const fakeTransport = {
  workspaceId: "ws-test",
  userId: "u-test",
  workspaceRoot: "/tmp/test",
  projectId: "p-test",
  createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
} as unknown as WorkspaceTransport;

describe("approval pause carries the quality session (round 8)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("a media run pausing on image.generate returns qualityLoopState at top level with scope media", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "",
      toolCalls: [{
        toolCallId: "tc-lion",
        toolId: "image.generate",
        inputs: { prompt: "a lion", projectId: "p-test" },
      }],
      finishReason: "tool_calls",
      model: "test-model",
    });

    const result = await runAgentLoopV2(
      "Generate an image of a lion",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        qualityLoop: {
          enabled: true,
          runId: "run-round8",
          projectId: "p-test",
          userId: "u-test",
          userRequest: "Generate an image of a lion",
          taskScope: "media",
        },
      },
    );

    expect(result.pendingApproval?.toolId).toBe("image.generate");
    // The regression pin: before the fix this was undefined on every
    // pause return, and the paused run persisted NULL.
    expect(result.qualityLoopState).toBeDefined();
    expect(result.qualityLoopState?.taskScope).toBe("media");
    // Both copies of the snapshot agree — the messages route reads
    // the top level, the nested-pause path reads pendingApproval.
    expect(result.qualityLoopState).toEqual(result.pendingApproval?.qualityLoopState);
  });
});
