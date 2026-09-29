// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * Per-mutation checkpoint proof (Item 8).
 *
 * Drives the real runAgentLoopV2 mutation path (real tool registry, real
 * permission engine, mocked LLM + transport) with 3 mutating tool calls and
 * 1 read-only call, and proves:
 *   - transport.createCheckpointBeforeMutation is invoked BEFORE EACH
 *     mutating tool call (3 invocations, one per mutation, in order)
 *   - it is NEVER invoked for the read-only call
 *
 * This is the regression test for the old once-per-run behavior, where only
 * the first mutation of a run got a rollback point.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

function makeTransport() {
  let n = 0;
  const checkpointLabels: string[] = [];
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    mkdir: vi.fn(async () => ({ created: true })),
    writeFile: vi.fn(async () => ({ written: true })),
    readFile: vi.fn(async () => ({ content: "hello", size: 5 })),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    })),
    createCheckpointBeforeMutation: vi.fn(async (label: string) => {
      n += 1;
      checkpointLabels.push(label);
      return { checkpointId: `cp-${n}`, label, gitSha: "a".repeat(40) };
    }),
  } as unknown as WorkspaceTransport;
  return { transport, checkpointLabels };
}

describe("runAgentLoopV2 — per-mutation checkpoints", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Building the site skeleton.",
        toolCalls: [
          { toolId: "files.mkdir", toolCallId: "tc-1", inputs: { path: "site" } },
          {
            toolId: "files.write",
            toolCallId: "tc-2",
            inputs: { projectId: "p-test", path: "site/index.html", content: "<h1>hi</h1>" },
          },
          { toolId: "files.read", toolCallId: "tc-3", inputs: { projectId: "p-test", path: "site/index.html" } },
          { toolId: "files.mkdir", toolCallId: "tc-4", inputs: { path: "site/assets" } },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });
  });

  it("creates a checkpoint before EACH mutating tool call, never for read-only calls", async () => {
    const { transport, checkpointLabels } = makeTransport();

    const result = await runAgentLoopV2("Build me a site", transport, {
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
      maxSteps: 5,
    });

    expect(result.cancelled).toBe(false);
    // All 4 calls executed in order: 3 mutations + 1 read
    expect(result.toolCalls.map((c) => c.toolId)).toEqual([
      "files.mkdir",
      "files.write",
      "files.read",
      "files.mkdir",
    ]);
    expect(result.toolCalls.every((c) => c.success)).toBe(true);

    // Exactly 3 checkpoints — one per mutation, in order, before each
    const createCheckpoint = vi.mocked(transport.createCheckpointBeforeMutation);
    expect(createCheckpoint).toHaveBeenCalledTimes(3);
    expect(checkpointLabels).toEqual([
      "Pre-mutation: files.mkdir (step 1)",
      "Pre-mutation: files.write (step 1)",
      "Pre-mutation: files.mkdir (step 1)",
    ]);

    // The read-only call never checkpoints: no label mentions files.read
    expect(checkpointLabels.some((l) => l.includes("files.read"))).toBe(false);

    // The run's recorded checkpoint is the latest one (per-mutation chain)
    expect(result.checkpoint?.checkpointId).toBe("cp-3");
  });

  it("emits a checkpoint progress event per mutation", async () => {
    const { transport } = makeTransport();
    const seen: string[] = [];
    const { ProgressEmitter } = await import("./progress-events");
    const progress = new ProgressEmitter((e) => {
      if (e.type === "checkpoint") seen.push((e as { label: string }).label);
    });

    await runAgentLoopV2("Build me a site", transport, {
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
      maxSteps: 5,
    }, progress);

    expect(seen).toHaveLength(3);
  });
});
