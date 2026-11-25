// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

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

const runAllProjectChecksMock = vi.fn();
const saveProjectCheckRunMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/projects/project-checks", () => ({
  runAllProjectChecks: (...args: unknown[]) => runAllProjectChecksMock(...args),
  saveProjectCheckRun: (...args: unknown[]) => saveProjectCheckRunMock(...args),
  completionChecksFailureMessage: (failed: Array<{ label: string }>) =>
    `The build finished and the files are saved, but the automatic checks did not all pass — ` +
    `${failed.map((c) => c.label).join(", ")} failed. The full results are in the Checks panel. ` +
    `I can't call this build successful until those checks pass.`,
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

/**
 * ACC-07 Item 2 — automatic checks at build completion. Acceptance
 * Run 1 on c15099b4 left all seven Checks at "Not run" after a
 * completed build. Now: a build that lands mutations runs all seven
 * before it may settle; results stream as build_result events (Jobs)
 * and persist (Checks panel); a failed check settles the run
 * honestly failed.
 */

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>",
].join("\n");

function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
  return {
    text: "",
    toolCalls: [{ toolCallId, toolId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}
const doneReply = {
  text: "Your bakery site is ready.",
  toolCalls: [],
  finishReason: "stop",
  model: "test-model",
};

function memoryTransport() {
  const files = new Map<string, string>();
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    readFile: vi.fn(async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`404 not found: ${p}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
      return { saved: true };
    }),
    listFiles: vi.fn(async (dir: string) => ({
      entries: [...files.keys()]
        .filter((k) => (dir === "." ? !k.includes("/") : k.startsWith(`${dir}/`)))
        .map((k) => ({ name: k.split("/").pop() as string, type: "file" })),
    })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

function checksOutcome(failedIds: string[] = []) {
  const defs = [
    ["build", "Build"],
    ["typecheck", "TypeScript"],
    ["lint", "Lint"],
    ["test", "Test"],
    ["security", "Security"],
    ["accessibility", "Accessibility"],
    ["performance", "Performance"],
  ] as const;
  const checks = defs.map(([id, label]) => ({
    id,
    label,
    status: failedIds.includes(id)
      ? ("failed" as const)
      : id === "accessibility" || id === "performance"
        ? ("not_configured" as const)
        : ("passed" as const),
    source: "Workspace",
    timestamp: new Date().toISOString(),
    durationMs: 25,
  }));
  return {
    checks,
    changedFiles: ["index.html"],
    pendingApprovals: [],
    checkpoints: [],
    summary: {
      total: 7,
      passed: checks.filter((c) => c.status === "passed").length,
      failed: failedIds.length,
      notConfigured: 2,
      changedFileCount: 1,
    },
    project: { id: "p-test", name: "Bakery", branch: "main", workspaceStatus: "ready" },
    totalDurationMs: 175,
  };
}

const config = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "auto" as const,
  enableBuildFix: false,
  isStaticWorkspace: true,
  userId: "u-test",
  conversationId: "conv-1",
  actionContext: {
    actionRunId: "run-1",
    userId: "u-test",
    projectId: "p-test",
    conversationId: "conv-1",
  },
};

describe("ACC-07 Item 2 — automatic checks at build completion", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    runAllProjectChecksMock.mockReset();
    saveProjectCheckRunMock.mockClear();
  });

  it("runs all seven checks, streams their results, and persists them tied to the conversation", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockResolvedValue(checksOutcome());
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      config,
    );

    expect(result.failedHonestly).toBeUndefined();
    expect(runAllProjectChecksMock).toHaveBeenCalledWith({ projectId: "p-test", userId: "u-test" });
    const buildResults = result.events.filter((e) => e.type === "build_result");
    expect(buildResults.map((e) => (e as { check: string }).check)).toEqual([
      "Build",
      "TypeScript",
      "Lint",
      "Test",
      "Security",
      "Accessibility",
      "Performance",
    ]);
    expect(saveProjectCheckRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-test", userId: "u-test", conversationId: "conv-1" }),
    );
  });

  it("settles honestly failed when a check fails — never a clean success", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockResolvedValue(checksOutcome(["typecheck"]));
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      config,
    );

    expect(result.failedHonestly).toBeTruthy();
    expect(result.failedHonestly).toContain("automatic checks did not all pass");
    expect(result.failedHonestly).toContain("TypeScript");
    expect(result.finalText).toBe(result.failedHonestly);
  });

  it("does not run checks for a run that mutated nothing", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockResolvedValue(checksOutcome());
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "The bakery opens at 7 AM.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });

    const result = await runAgentLoopV2("When does the bakery open?", transport, config);

    expect(result.failedHonestly).toBeUndefined();
    expect(runAllProjectChecksMock).not.toHaveBeenCalled();
  });

  it("does not fail the build when the checks themselves cannot run", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockRejectedValue(new Error("workspace not ready"));
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      config,
    );

    // No fabricated results, no false failure: the build's own
    // evidence decides its outcome.
    expect(result.failedHonestly).toBeUndefined();
    expect(result.events.filter((e) => e.type === "build_result")).toEqual([]);
  });
});
