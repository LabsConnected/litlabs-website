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
// The approved image.stock call executes on resume; stub the stock
// resolver to "no image available" so the handler returns promptly
// without any network access.
vi.mock("@/lib/site-enrich/resolver", () => ({
  resolveSlotImage: vi.fn(async () => null),
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
      `Note: the automatic checks ran for this build, but their results could not be ` +
      `saved — the Checks panel and the Jobs tab will show them as not run. You can ` +
      `run the checks again from the Checks panel.`,
    completionChecksUnavailableNotSavedNote: (reason: string) =>
      `IMPORTANT — the automatic checks did NOT run for this build: ${reason}. ` +
      `Nothing verified the finished site, so treat this build as unchecked — and ` +
      `this could not be recorded either, so the Checks panel will show the checks ` +
      `as not run. They can be run from the Checks panel once the workspace is reachable.`,
    unavailableCheckSet,
    unavailableCheckSetFromError: (error: InstanceType<typeof ProjectChecksUnavailableError>) =>
      unavailableCheckSet(error.message, error.body?.checks),
  };
});

import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, callLLMWithTools } from "./llm-tool-calling";

/**
 * ACC-08 Defect 1 — the RESUME path into the completion checks.
 * Acceptance Run 1 on ba16d435 was exactly this journey: the build
 * paused for an image.stock approval, resumed, completed — and the
 * checks never ran, leaving no trace. ACC-07's tests only drove the
 * initial path with project-checks mocked, so the resume tail was
 * never exercised. These tests drive resumeAgentLoopV2 through the
 * pause → approve → resume journey and pin the tail behavior.
 */

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>",
].join("\n");

const INSTRUCTION = "Build a one-page website for a bakery called Sunny Crust Bakery";

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

function checksOutcome() {
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
    status: id === "accessibility" || id === "performance" ? ("not_configured" as const) : ("passed" as const),
    source: "Workspace",
    timestamp: new Date().toISOString(),
    durationMs: 25,
  }));
  return {
    checks,
    changedFiles: ["index.html"],
    pendingApprovals: [],
    checkpoints: [],
    summary: { total: 7, passed: 5, failed: 0, notConfigured: 2, changedFileCount: 1 },
    project: { id: "p-test", name: "Bakery", branch: "main", workspaceStatus: "ready" },
    totalDurationMs: 175,
  };
}

/** The Run 1 journey: the build paused on image.stock before any
 *  file existed; the user approved; the run resumed. */
function makeStockPauseResume(): ResumeInput {
  const inputs = { query: "fresh bakery bread" };
  return {
    pausedMessages: [
      { role: "user", content: INSTRUCTION },
      buildAssistantToolCallMessage(
        [{ toolId: "image.stock", toolCallId: "tc-stock", inputs }],
        "",
        undefined,
      ),
    ],
    toolId: "image.stock",
    toolCallId: "tc-stock",
    inputs,
    decision: "approved",
    config: {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
      isStaticWorkspace: true,
      userId: "u-test",
      conversationId: "conv-2",
      actionContext: {
        actionRunId: "run-2",
        userId: "u-test",
        projectId: "p-test",
        conversationId: "conv-2",
      },
    },
    stepsUsedBeforePause: 1,
    hadInterveningMutation: false,
  };
}

describe("ACC-08 Defect 1 — automatic checks on the approval-resumed path", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    runAllProjectChecksMock.mockReset();
    saveProjectCheckRunMock.mockClear();
  });

  it("runs all seven checks after an image.stock pause → approve → resume, persisted under the resume conversation", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockResolvedValue(checksOutcome());
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeStockPauseResume(), transport);

    expect(result.failedHonestly).toBeUndefined();
    expect(runAllProjectChecksMock).toHaveBeenCalledWith({ projectId: "p-test", userId: "u-test" });
    const buildResults = result.events.filter((e) => e.type === "build_result");
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
      expect.objectContaining({ projectId: "p-test", userId: "u-test", conversationId: "conv-2" }),
    );
  });

  it("a checks failure on the resume path still leaves the loud note and the persisted unavailable set — never silence", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockRejectedValue(new Error("terminal not configured"));
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeStockPauseResume(), transport);

    expect(result.failedHonestly).toBeUndefined();
    expect(result.checksNote).toBeTruthy();
    expect(result.checksNote).toContain("automatic checks did NOT run");
    expect(result.finalText).toContain("automatic checks did NOT run");
    expect(saveProjectCheckRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-2",
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "build", status: "unavailable" }),
        ]),
      }),
    );
  });

  it("checks ran on resume but could not be saved: the closing note is truthful — no Jobs claim (ACC-09)", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockResolvedValue(checksOutcome());
    saveProjectCheckRunMock.mockResolvedValueOnce(false);
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeStockPauseResume(), transport);

    expect(result.failedHonestly).toBeUndefined();
    expect(result.checksNote).toContain("could not be saved");
    expect(result.checksNote).toContain("will show them as not run");
    expect(result.checksNote).not.toContain("are in this run's Jobs tab");
    // The note placement this defect is about: it rides the
    // RESUMED run's closing message — the exact message Acceptance
    // Run 1 on aedb2b05 found bare while later publish messages
    // carried theirs.
    expect(result.finalText).toContain("could not be saved");
    expect(result.finalText).toContain("will show them as not run");
  });

  it("checks could not run on resume AND the unavailable set could not be saved: the note admits nothing was recorded (ACC-09)", async () => {
    const { transport } = memoryTransport();
    runAllProjectChecksMock.mockRejectedValue(new Error("terminal not configured"));
    saveProjectCheckRunMock.mockResolvedValueOnce(false);
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeStockPauseResume(), transport);

    expect(result.failedHonestly).toBeUndefined();
    expect(result.checksNote).toContain("automatic checks did NOT run");
    expect(result.checksNote).toContain("could not be recorded");
    expect(result.checksNote).not.toContain("shows the checks as unavailable");
    expect(result.finalText).toContain("could not be recorded");
  });
});
