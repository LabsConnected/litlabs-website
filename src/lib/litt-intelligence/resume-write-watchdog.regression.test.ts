// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * REGRESSION TESTS — resumed-build zero-write failure (2026-10-19).
 *
 * Production incident: an ACT-mode build on staging paused for approval
 * (1 image.generate + 5 files.write). After the approvals, the resumed
 * build stopped itself with:
 *   "The resumed build made no successful file writes in 3 steps;
 *    stopping to preserve the remaining budget."
 * even though the approval chain exists precisely to execute those
 * writes inside the resume itself.
 *
 * These tests pin three defects in resumeAgentLoopV2 /
 * executeDeferredToolCalls on the current code. Each FAILS on the
 * current code for the stated reason and passes once the diagnosed
 * correction lands. They are diagnosis evidence, not a fix.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, type LLMMessage } from "./llm-tool-calling";
import { callLLMWithTools } from "./llm-tool-calling";

const WRITE_INPUTS = { projectId: "p-test", path: "index.html", content: "<h1>Harbor Coffee</h1>" };

function makeTransport() {
  const writeCalls: Array<{ path: string; content: string }> = [];
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    writeFile: vi.fn(async (path: string, content: string) => {
      writeCalls.push({ path, content });
      return { saved: true, path, bytes: content.length };
    }),
    readFile: vi.fn(async (path: string) => ({ content: `content of ${path}`, size: 42 })),
    mkdir: vi.fn(async () => ({ created: true })),
    createCheckpointBeforeMutation: vi.fn(async () => null),
  } as unknown as WorkspaceTransport;
  return { transport, writeCalls };
}

/** Paused state: the model emitted ONE files.write and the run paused on it. */
function makeWritePausedInput(overrides?: Partial<ResumeInput>): ResumeInput {
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId: "files.write", toolCallId: "tc-w1", inputs: WRITE_INPUTS }],
    "Creating the main page.",
    undefined,
  );
  return {
    pausedMessages: [
      { role: "user", content: "Build a one-page site for Harbor Coffee" },
      assistantMsg,
    ],
    toolId: "files.write",
    toolCallId: "tc-w1",
    inputs: WRITE_INPUTS,
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
      // Exactly what the approvals route sets when the gated tool is a
      // file writer (route.ts: buildCapabilityGuard on isFileWritingTool).
      buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
    },
    stepsUsedBeforePause: 4,
    hadInterveningMutation: false,
    ...overrides,
  };
}

describe("regression: resumed-build zero-write watchdog", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("does not kill the resumed build for 'no file writes' when the approved write executed in the same resume", async () => {
    // The approved files.write executes inside the resume (pre-loop).
    // The model then spends its continuation steps on verification reads
    // — legitimate finishing work, because from its history the writes
    // are done. The watchdog must credit the write the resume itself
    // just executed; today resumeZeroWriteSteps counts ONLY
    // continuation batches, so the run fails with a false message.
    const readCall = (id: string, path: string) => ({
      text: `Checking ${path}.`,
      toolCalls: [{ toolId: "files.read", toolCallId: id, inputs: { path } }],
      finishReason: "tool_calls",
      model: "deepseek-4-flash",
    });
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(readCall("tc-r1", "index.html"))
      .mockResolvedValueOnce(readCall("tc-r2", "styles.css"))
      .mockResolvedValueOnce(readCall("tc-r3", "app.js"))
      .mockResolvedValue({
        text: "Site verified. Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "deepseek-4-flash",
      });

    const { transport, writeCalls } = makeTransport();
    const result = await resumeAgentLoopV2(makeWritePausedInput(), transport);

    // The approved write DID land in this resume segment.
    expect(writeCalls).toEqual([{ path: WRITE_INPUTS.path, content: WRITE_INPUTS.content }]);
    // …so the run must not report that no successful file writes happened.
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).not.toContain("made no successful file writes");
  });

  it("dedupe-replays a model re-issue of the approved write instead of gating it again", async () => {
    // The approved tool executes on resume, but it is never recorded in
    // the resume's executedMutations ledger (fresh Map at resume start;
    // the direct execution does not set it — unlike toolCallRecords,
    // which IS seeded from history). When the model re-emits the
    // identical write in its continuation, the dedupe check that would
    // replay it in the main loop misses, and the call falls through to
    // the ACT approval gate — demanding a SECOND approval for work the
    // user already approved and the run already executed.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Writing the main page now.",
        toolCalls: [{ toolId: "files.write", toolCallId: "tc-w1-again", inputs: WRITE_INPUTS }],
        finishReason: "tool_calls",
        model: "deepseek-4-flash",
      })
      .mockResolvedValue({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "deepseek-4-flash",
      });

    const { transport, writeCalls } = makeTransport();
    const result = await resumeAgentLoopV2(makeWritePausedInput(), transport);

    expect(writeCalls).toEqual([{ path: WRITE_INPUTS.path, content: WRITE_INPUTS.content }]); // executed exactly once
    expect(result.pendingApproval).toBeUndefined(); // not re-gated
    const replay = result.toolCalls.find(
      (c) => c.toolId === "files.write" && c.summary.includes("already executed"),
    );
    expect(replay?.success).toBe(true);
  });

  it("records a deferred mutation's handler-level failure ({success:false}) as a failure, not a success", async () => {
    // executeDeferredToolCalls is the one execution site that does NOT
    // apply handlerFailureError normalization (main loop, approved-tool
    // path, continuation loop, and build-fix repair all do). A deferred
    // files.write whose handler returns { success: false } inside an
    // ok registry result is logged as success — false mutation evidence
    // for the quality gate and the route's successfulMutation check.
    const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
      [
        { toolId: "files.mkdir", toolCallId: "tc-mkdir-1", inputs: { path: "src" } },
        { toolId: "files.write", toolCallId: "tc-w1", inputs: WRITE_INPUTS },
      ],
      "Creating the directory and the main page.",
      undefined,
    );
    const { transport } = makeTransport();
    // The write handler's transport reports the failure as a VALUE
    // (the pattern the approved-path regression test documents).
    (transport.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("workspace storage unavailable"),
    );
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "deepseek-4-flash",
    });

    const result = await resumeAgentLoopV2(
      {
        pausedMessages: [
          { role: "user", content: "Build a one-page site for Harbor Coffee" },
          assistantMsg,
        ],
        toolId: "files.mkdir",
        toolCallId: "tc-mkdir-1",
        inputs: { path: "src" },
        decision: "approved",
        config: {
          systemPrompt: "You are LiTT.",
          // AUTO: files.write is in the auto-approve safe set, so the
          // deferred remainder executes inside the resume (no new gate).
          executionMode: "auto",
          enableBuildFix: false,
        },
        stepsUsedBeforePause: 4,
        hadInterveningMutation: false,
        deferredToolCalls: [
          { toolId: "files.write", toolCallId: "tc-w1", inputs: WRITE_INPUTS },
        ],
      },
      transport,
    );

    const writeLog = result.toolCalls.filter((c) => c.toolId === "files.write");
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].success).toBe(false);
  });
});
