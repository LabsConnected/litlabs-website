// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Round 14 — settlement must never wait on the sandbox.
 *
 * Both loop tails used to await createAfterRunCheckpoint BEFORE
 * emitting "finished" and returning. The checkpoint is a sandbox
 * transport operation; when the sandbox data path is sick (the
 * 2026-11-17 lion proof's window), that await can hang — and with
 * it the whole settlement: the paused-run row, the transcript
 * writeback, and the action-run status all wait on the loop's
 * return. The tails now emit "finished" first and bound the
 * checkpoint at AFTER_RUN_CHECKPOINT_TIMEOUT_MS.
 *
 * This test drives the resume tail (the lion run was a resume):
 * the approved files.write lands, the workspace evidence reads
 * "changed", and the after-run checkpoint call never resolves.
 * The resumed run must still settle — after the bound, not never.
 */

vi.mock("../llm-tool-calling", async (original) => ({
  ...(await (original() as Promise<Record<string, unknown>>)),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/metering", () => ({
  emitUsageEvent: vi.fn(async () => ({})),
  getMeteringContext: vi.fn(() => null),
  runWithMeteringContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import { callLLMWithTools } from "../llm-tool-calling";
import { runAgentLoopV2, resumeAgentLoopV2, AFTER_RUN_CHECKPOINT_TIMEOUT_MS } from "../agent-loop-v2";
import { ProgressEmitter, type ProgressEvent } from "../progress-events";
import type { WorkspaceTransport } from "../workspace-transport";
import type { AgentLoopConfig } from "../agent-loop-v2";

const CONTENT = "<!doctype html><html><body><h1>Lion</h1></body></html>";

function makeConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    maxSteps: 5,
    maxRuntimeMs: 600_000,
    maxOutputChars: 8_000,
    maxRetries: 0,
    executionMode: "act",
    systemPrompt: "test system prompt",
    enableBuildFix: false,
    userId: "owner",
    ...overrides,
  };
}

describe("after-run checkpoint bound (round 14)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a hanging after-run checkpoint cannot block the resumed run's settlement", async () => {
    vi.useFakeTimers();

    const files = new Map<string, string>();
    const afterGate: { release: (() => void) | null } = { release: null };
    let afterCheckpointCalls = 0;

    const transport = {
      workspaceId: "ws-1",
      projectId: "project-1",
      userId: "owner",
      workspaceRoot: "/workspace",
      listFiles: vi.fn(async () => ({
        entries: [...files.keys()].map((name) => ({ name, type: "file" as const })),
      })),
      readFile: vi.fn(async (path: string) => {
        const content = files.get(path);
        if (content === undefined) throw new Error("not found");
        return { content, size: content.length };
      }),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
        return { saved: true };
      }),
      createCheckpointBeforeMutation: vi.fn(async (label: string) => {
        if (label.startsWith("After LiTT run:")) {
          afterCheckpointCalls++;
          // The sick sandbox: this call never resolves until the
          // test releases it — long after the bound has fired.
          await new Promise<void>((resolve) => {
            afterGate.release = resolve;
          });
          return { checkpointId: "cp-after", label, gitSha: "sha-after" };
        }
        return null;
      }),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 })),
      gitStatus: vi.fn(async () => ({
        branch: "main", ahead: 0, behind: 0,
        staged: [], modified: [], untracked: [], clean: true,
      })),
      gitDiff: vi.fn(async () => ({ diff: "" })),
    } as unknown as WorkspaceTransport;

    // Initial run: the model asks to write the file → approval pause.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Writing the page.",
      model: "test",
      finishReason: "tool_calls",
      toolCalls: [
        {
          toolId: "files.write",
          toolCallId: "write-1",
          inputs: { projectId: "project-1", path: "index.html", content: CONTENT },
        },
      ],
    } as never);
    // Every later call (the resume's continuation): finish cleanly.
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done.",
      model: "test",
      finishReason: "stop",
      toolCalls: [],
    } as never);

    const initial = await runAgentLoopV2("Build a page", transport, makeConfig());
    const pending = initial.pendingApproval;
    expect(pending?.toolId).toBe("files.write");
    if (!pending) throw new Error("expected an approval pause");

    const events: ProgressEvent[] = [];
    const progress = new ProgressEmitter((e) => events.push(e));

    const resumePromise = resumeAgentLoopV2(
      {
        pausedMessages: pending.pausedMessages ?? [],
        toolId: pending.toolId,
        toolCallId: pending.toolCallId,
        inputs: pending.inputs as Record<string, unknown>,
        decision: "approved",
        stepsUsedBeforePause: pending.stepsUsedAtPause ?? 1,
        hadInterveningMutation: pending.hadInterveningMutationAtPause ?? false,
        deferredToolCalls: pending.deferredToolCalls,
        config: makeConfig(),
      },
      transport,
      progress,
    );
    let settled = false;
    void resumePromise.then(() => {
      settled = true;
    });

    // Pump until the tail reaches the (hanging) after-run checkpoint.
    for (let i = 0; i < 100 && afterCheckpointCalls === 0; i++) {
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(afterCheckpointCalls).toBe(1);
    expect(files.get("index.html")).toBe(CONTENT);

    // The checkpoint is hanging, but "finished" must ALREADY have
    // been emitted — settlement no longer waits on the sandbox.
    expect(events.some((e) => e.type === "finished")).toBe(true);
    expect(settled).toBe(false); // the return waits out the bound

    // The bound fires: the run settles without a checkpoint.
    await vi.advanceTimersByTimeAsync(AFTER_RUN_CHECKPOINT_TIMEOUT_MS + 1_000);
    const result = await resumePromise;
    expect(settled).toBe(true);
    expect(result.afterCheckpoint).toBeUndefined();
    expect(result.cancelled).toBe(false);

    // The late checkpoint completion must not emit a "checkpoint"
    // event after "finished" already closed the stream.
    const finishedIdx = events.findIndex((e) => e.type === "finished");
    afterGate.release?.();
    await vi.advanceTimersByTimeAsync(100);
    const lateCheckpointEvents = events
      .slice(finishedIdx + 1)
      .filter((e) => e.type === "checkpoint");
    expect(lateCheckpointEvents).toHaveLength(0);
  }, 30_000);
});
