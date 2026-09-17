// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * Regression test for the ACT-mode approval-resume execution gap (P0).
 *
 * Production defect (2026-09-16): a build run pauses at an approval gate
 * ("Mutation requires approval in ACT mode" — files.mkdir), the user clicks
 * Approve, the gate resolves — and the run goes Idle WITHOUT executing the
 * approved mutation. No files are created; a later "continue" starts a new
 * run that re-plans and hits the same gate again (infinite loop).
 *
 * These tests verify the core resume contract of resumeAgentLoopV2:
 *   - approved → the frozen tool executes EXACTLY once with the frozen
 *     inputs, the result is injected into the conversation, and the loop
 *     continues (no new approval gate for the same call)
 *   - rejected → the tool does NOT execute; a rejection result is injected
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, type LLMMessage } from "./llm-tool-calling";
import { callLLMWithTools } from "./llm-tool-calling";

const MKDIR_PATH = "src/app/(marketing)/roofing";

function makeTransport() {
  const mkdirCalls: string[] = [];
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    mkdir: vi.fn(async (path: string) => {
      mkdirCalls.push(path);
      return { created: true };
    }),
    createCheckpointBeforeMutation: vi.fn(async () => null),
  } as unknown as WorkspaceTransport;
  return { transport, mkdirCalls };
}

/** Faithful paused state: assistant emitted files.mkdir, run paused before execution. */
function makePausedInput(overrides?: Partial<ResumeInput>): ResumeInput {
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId: "files.mkdir", toolCallId: "tc-mkdir-1", inputs: { path: MKDIR_PATH } }],
    "Creating the roofing directory.",
    undefined,
  );
  const pausedMessages: LLMMessage[] = [
    { role: "user", content: "Build a roofing site" },
    assistantMsg,
  ];
  return {
    pausedMessages,
    toolId: "files.mkdir",
    toolCallId: "tc-mkdir-1",
    inputs: { path: MKDIR_PATH },
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    },
    stepsUsedBeforePause: 2,
    hadInterveningMutation: false,
    ...overrides,
  };
}

describe("resumeAgentLoopV2 — approved mutation executes", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    // The continuation turn ends the run without further tool calls.
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Directory created. Continuing with the site files.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });
  });

  it("executes the approved files.mkdir exactly once with the frozen inputs", async () => {
    const { transport, mkdirCalls } = makeTransport();

    const result = await resumeAgentLoopV2(makePausedInput(), transport);

    expect(mkdirCalls).toEqual([MKDIR_PATH]);
    const mkdirLog = result.toolCalls.filter((c) => c.toolId === "files.mkdir");
    expect(mkdirLog).toHaveLength(1);
    expect(mkdirLog[0].success).toBe(true);
    expect(mkdirLog[0].mutating).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.pendingApproval).toBeUndefined();
  });

  it("does NOT execute the tool when the decision is rejected", async () => {
    const { transport, mkdirCalls } = makeTransport();

    const result = await resumeAgentLoopV2(
      makePausedInput({ decision: "rejected", rejectionReason: "not now" }),
      transport,
    );

    expect(mkdirCalls).toEqual([]);
    expect(result.toolCalls.some((c) => c.toolId === "files.mkdir" && c.success)).toBe(false);
  });

  it("injects the approved tool result into the resumed conversation", async () => {
    const { transport } = makeTransport();

    await resumeAgentLoopV2(makePausedInput(), transport);

    const [, messages] = vi.mocked(callLLMWithTools).mock.calls[0];
    const toolMsg = (messages as LLMMessage[]).find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe("tc-mkdir-1");
    expect(toolMsg?.content).toContain(MKDIR_PATH);
  });

  it("records a handler-level failure ({success:false}) as a failed call, not a mutation", async () => {
    // The workspace transport is unreachable: the handler catches the
    // throw and returns { success: false, error } as a normal value.
    // Production 2026-09-16: this was recorded as success:true, the run
    // completed "successfully" with nothing created, and the user saw Idle.
    const mkdirCalls: string[] = [];
    const runCheck = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      mkdir: vi.fn(async (path: string) => {
        mkdirCalls.push(path);
        throw new Error("mkdir failed (ECONNREFUSED): terminal server unreachable");
      }),
      createCheckpointBeforeMutation: vi.fn(async () => null),
      discoverPackageInfo: vi.fn(async () => ({ packageManager: "npm" })),
      runCheck,
    } as unknown as WorkspaceTransport;

    const result = await resumeAgentLoopV2(
      makePausedInput({
        config: {
          systemPrompt: "You are LiTT.",
          executionMode: "act",
          enableBuildFix: true,
        },
      }),
      transport,
    );

    expect(mkdirCalls).toEqual([MKDIR_PATH]);
    const mkdirLog = result.toolCalls.filter((c) => c.toolId === "files.mkdir");
    expect(mkdirLog).toHaveLength(1);
    expect(mkdirLog[0].success).toBe(false);
    // The failed call must be visible to the model as an error…
    const [, messages] = vi.mocked(callLLMWithTools).mock.calls[0];
    const toolMsg = (messages as LLMMessage[]).find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/^Error:/);
    expect(toolMsg?.content).toContain("unreachable");
    // …and must not count as an intervening mutation (no build-fix run
    // triggered by a mutation that never happened).
    expect(runCheck).not.toHaveBeenCalled();
  });
});
