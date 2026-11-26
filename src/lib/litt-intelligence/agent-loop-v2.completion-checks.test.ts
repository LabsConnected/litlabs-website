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
vi.mock("@/lib/projects/project-checks", () => {
  class ProjectChecksUnavailableError extends Error {
    readonly status: number;
    readonly body: Record<string, unknown>;
    constructor(status: number, body: Record<string, unknown>) {
      super(typeof body.error === "string" ? body.error : "Project checks unavailable");
      this.name = "ProjectChecksUnavailableError";
      this.status = status;
      this.body = body;
    }
  }
  const CHECK_DEFS = [
    ["build", "Build"],
    ["typecheck", "TypeScript"],
    ["lint", "Lint"],
    ["test", "Test"],
    ["security", "Security"],
    ["accessibility", "Accessibility"],
    ["performance", "Performance"],
  ] as const;
  const unavailableCheckSet = (reason: string, carried?: unknown) => {
    const carriedById = new Map<string, Record<string, unknown>>();
    if (Array.isArray(carried)) {
      for (const entry of carried) {
        if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
          carriedById.set((entry as { id: string }).id, entry as Record<string, unknown>);
        }
      }
    }
    const checks = CHECK_DEFS.map(([id, label]) => {
      const entry = carriedById.get(id);
      return {
        id,
        label,
        status: "unavailable" as const,
        source: typeof entry?.source === "string" ? entry.source : "Active project workspace",
        timestamp: new Date().toISOString(),
        output: null,
        error: typeof entry?.error === "string" ? entry.error : reason,
      };
    });
    return {
      checks,
      summary: { total: 7, passed: 0, failed: 0, notConfigured: 0, changedFileCount: 0 },
    };
  };
  return {
    ProjectChecksUnavailableError,
    runAllProjectChecks: (...args: unknown[]) => runAllProjectChecksMock(...args),
    saveProjectCheckRun: (...args: unknown[]) => saveProjectCheckRunMock(...args),
    completionChecksFailureMessage: (failed: Array<{ label: string }>) =>
      `The build finished and the files are saved, but the automatic checks did not all pass — ` +
      `${failed.map((c) => c.label).join(", ")} failed. The full results are in the Checks panel. ` +
      `I can't call this build successful until those checks pass.`,
    completionChecksUnavailableNote: (reason: string) =>
      `IMPORTANT — the automatic checks did NOT run for this build: ${reason}. ` +
      `Nothing verified the finished site, so treat this build as unchecked: the Checks panel ` +
      `shows the checks as unavailable rather than passed, and they can be run from there ` +
      `once the workspace is reachable.`,
    completionChecksNotSavedNote: () =>
      `Note: the automatic checks ran for this build and their results are in this run's ` +
      `Jobs tab, but the results could not be saved — the Checks panel may still show ` +
      `them as not run.`,
    unavailableCheckSet,
    unavailableCheckSetFromError: (error: InstanceType<typeof ProjectChecksUnavailableError>) =>
      unavailableCheckSet(error.message, error.body?.checks),
  };
});

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";
import { ProjectChecksUnavailableError } from "@/lib/projects/project-checks";

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
    // ACC-08: the tail layout verdict ("Layout") streams first, then
    // the seven project checks in order.
    expect(buildResults.map((e) => (e as { check: string }).check)).toEqual([
      "Layout",
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

  // ACC-08 Defect 1 — this test REPLACES the ACC-07 expectation that
  // blessed the silent swallow (a rejecting runAllProjectChecks used
  // to produce a clean success with zero trace — the exact shape of
  // Acceptance Run 1 on ba16d435). Larry's ruling: the build still
  // counts, but a throw in the checks path MUST leave a persisted
  // unavailable set and a loud visible note. If either disappears,
  // this test fails.
  it("does not fail the build when the checks cannot run — but persists the unavailable set and says so loudly", async () => {
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

    // The build's own evidence decides its outcome — no false failure.
    expect(result.failedHonestly).toBeUndefined();
    // …but never silent: the loud note rides the result and the
    // closing text.
    expect(result.checksNote).toBeTruthy();
    expect(result.checksNote).toContain("automatic checks did NOT run");
    expect(result.checksNote).toContain("workspace not ready");
    expect(result.finalText).toContain("automatic checks did NOT run");
    // The unavailable set was persisted (all seven, status
    // unavailable) so the panel and Jobs show the truth.
    expect(saveProjectCheckRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-test",
        userId: "u-test",
        conversationId: "conv-1",
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "build", status: "unavailable" }),
          expect.objectContaining({ id: "performance", status: "unavailable" }),
        ]),
      }),
    );
    const savedChecks = (saveProjectCheckRunMock.mock.calls[0]?.[0] as { checks: unknown[] }).checks;
    expect(savedChecks).toHaveLength(7);
    // No check is dressed up as passed or failed — the only
    // build_result is the Layout verdict, which really did run.
    const buildResults = result.events.filter((e) => e.type === "build_result");
    expect(buildResults.map((e) => (e as { check: string }).check)).toEqual(["Layout"]);
  });

  it("persists the unavailable set CARRIED by a ProjectChecksUnavailableError (workspace-not-ready 422)", async () => {
    const { transport } = memoryTransport();
    const carried = [
      "build",
      "typecheck",
      "lint",
      "test",
      "security",
      "accessibility",
      "performance",
    ].map((id) => ({
      id,
      label: id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1),
      status: "unavailable",
      source: "Active project workspace",
      timestamp: new Date().toISOString(),
      output: null,
      error: "Project workspace is not ready",
    }));
    runAllProjectChecksMock.mockRejectedValue(
      new ProjectChecksUnavailableError(422, { error: "Project workspace is not ready", checks: carried }),
    );
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
    expect(result.checksNote).toContain("Project workspace is not ready");
    expect(saveProjectCheckRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "build", status: "unavailable", error: "Project workspace is not ready" }),
        ]),
      }),
    );
  });

  it("notes it loudly when the checks ran but their results could not be saved", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockResolvedValue(checksOutcome());
    saveProjectCheckRunMock.mockResolvedValueOnce(false);
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
    expect(result.checksNote).toBeTruthy();
    expect(result.checksNote).toContain("could not be saved");
    expect(result.finalText).toContain("could not be saved");
  });
});
