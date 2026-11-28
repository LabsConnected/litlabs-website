// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "child_process";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * Subprocess cancellation — resolve or contain (Larry's final gate,
 * 2026-11-27). The residual named by the merge gate was: an abort
 * abandons the loop's await, but a mutating handler's underlying work
 * (a WorkspaceTransport call to the terminal service) cannot be
 * confirmed stopped, yet the run reported itself simply "cancelled".
 *
 * Contract pinned here:
 *   - the registry never DISPATCHES a mutating tool once the run's
 *     abort signal has fired (recorded refusal, handler never runs);
 *   - the run's signal reaches handlers through the execution context;
 *   - an abort that cuts off a MUTATING call mid-flight marks the run
 *     cleanupPending and the closing text says a change could not be
 *     confirmed stopped — an abort during READ-ONLY work does not;
 *   - settlement for such a run is exactly-once, outcome "cancelled",
 *     steps used == actual model calls, one terminal event;
 *   - the child-process kill wiring (killChildOnAbort) really kills a
 *     spawned process tree on abort. Studio's workspace handlers spawn
 *     no in-process children — they ride the transport to the terminal
 *     service — so the wiring is proven against a real child here.
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

import { CLEANUP_PENDING_NOTE, runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { killChildOnAbort, toolRegistry } from "./tool-registry";
import { buildAssistantToolCallMessage, callLLMWithTools } from "./llm-tool-calling";

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Harbor Lights Coffee</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Harbor Lights Coffee</h1><p>Your daily dose of coastal calm.</p></body></html>",
].join("\n");

const NEW_PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>About — Harbor Lights</title>",
  "</head><body><h1>About Harbor Lights</h1><p>A small coastal coffee shop.</p></body></html>",
].join("\n");

function diskTransport(initial: Record<string, string> = {}) {
  const disk = new Map<string, string>(Object.entries(initial));
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    readFile: vi.fn(async (path: string) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error(`readFile failed (404): ${path}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      disk.set(path, content);
    }),
    mkdir: vi.fn(async () => ({ created: true })),
    createCheckpointBeforeMutation: vi.fn(async (label: string) => ({ checkpointId: "cp-1", label, gitSha: "a".repeat(40) })),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [] as string[],
      untracked: [] as string[],
      modified: disk.get("index.html") === initial["index.html"] ? [] : ["index.html"],
      clean: disk.get("index.html") === initial["index.html"],
    })),
  } as unknown as WorkspaceTransport;
  return { transport, disk };
}

function toolReply(toolId: string, inputs: Record<string, unknown>, id: string) {
  return {
    text: "",
    toolCalls: [{ toolCallId: id, toolId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}

function textReply(text: string) {
  return { text, toolCalls: [], finishReason: "stop", model: "test-model" };
}

/** Poll until a mock has been called (the in-flight moment), or fail. */
async function untilCalled(fn: ReturnType<typeof vi.fn>, label: string) {
  for (let i = 0; i < 200; i++) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label} to be called`);
}

const BASE_CFG = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  userId: "u-test",
  executionMode: "auto",
  enableBuildFix: false,
  isStaticWorkspace: true,
  maxSteps: 40,
} as const;

describe("cancellation containment — abort during a mutating tool", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("settles cancelled with cleanupPending, the honest closing note, and no further model calls or mutations", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const hangingWrite = vi.fn((_path: string, _content: string) => new Promise<void>(() => {}));
    (transport as { writeFile: unknown }).writeFile = hangingWrite;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "about.html", content: NEW_PAGE }, "tc-write"))
      .mockResolvedValue(textReply("This reply must never be consumed."));

    const controller = new AbortController();
    const runPromise = runAgentLoopV2("add an about page", transport, { ...BASE_CFG, signal: controller.signal });
    await untilCalled(hangingWrite, "transport.writeFile");
    controller.abort();
    const result = await runPromise;

    expect(result.cancelled).toBe(true);
    expect(result.cleanupPending).toBe(true);
    expect(result.finalText).toContain(CLEANUP_PENDING_NOTE);
    // No further inference, no further mutation dispatch after the abort.
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(1);
    expect(hangingWrite).toHaveBeenCalledTimes(1);
    // Settlement: exactly-once, cancelled outcome, steps == model calls,
    // exactly one terminal event and it is the cancelled one.
    expect(result.stepsUsed).toBe(1);
    expect(result.runObservability?.outcome).toBe("cancelled");
    expect(result.events.filter((e) => e.type === "cancelled")).toHaveLength(1);
    expect(result.events.filter((e) => e.type === "finished")).toHaveLength(0);
  });

  it("abort during READ-ONLY work settles cancelled WITHOUT cleanupPending — fully stopped is the truth", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const hangingRead = vi.fn((_path: string) => new Promise<{ content: string; size: number }>(() => {}));
    (transport as { readFile: unknown }).readFile = hangingRead;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.read", { projectId: "p-test", path: "index.html" }, "tc-read"))
      .mockResolvedValue(textReply("This reply must never be consumed."));

    const controller = new AbortController();
    const runPromise = runAgentLoopV2("read the home page", transport, { ...BASE_CFG, signal: controller.signal });
    await untilCalled(hangingRead, "transport.readFile");
    controller.abort();
    const result = await runPromise;

    expect(result.cancelled).toBe(true);
    expect(result.cleanupPending).toBeUndefined();
    expect(result.finalText).not.toContain(CLEANUP_PENDING_NOTE);
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(1);
    expect(result.runObservability?.outcome).toBe("cancelled");
  });

  it("resume segment: an abort cutting off a post-approval mutating call also marks cleanupPending", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const hangingWrite = vi.fn((_path: string, _content: string) => new Promise<void>(() => {}));
    (transport as { writeFile: unknown }).writeFile = hangingWrite;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("files.write", { projectId: "p-test", path: "about.html", content: NEW_PAGE }, "tc-write"))
      .mockResolvedValue(textReply("This reply must never be consumed."));

    const controller = new AbortController();
    const resumeInput: ResumeInput = {
      pausedMessages: [
        { role: "user", content: "Build a one-page site for Harbor Lights Coffee" },
        buildAssistantToolCallMessage(
          [{ toolId: "files.mkdir", toolCallId: "tc-0", inputs: { path: "assets" } }],
          "Setting up the project.",
          undefined,
        ),
      ],
      toolId: "files.mkdir",
      toolCallId: "tc-0",
      inputs: { path: "assets" },
      decision: "approved",
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
      config: { ...BASE_CFG, signal: controller.signal },
    };
    const runPromise = resumeAgentLoopV2(resumeInput, transport);
    await untilCalled(hangingWrite, "transport.writeFile");
    controller.abort();
    const result = await runPromise;

    expect(vi.mocked(transport.mkdir)).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    expect(result.cleanupPending).toBe(true);
    expect(result.finalText).toContain(CLEANUP_PENDING_NOTE);
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(1);
    expect(hangingWrite).toHaveBeenCalledTimes(1);
    expect(result.runObservability?.outcome).toBe("cancelled");
  });
});

describe("cancellation containment — registry dispatch guard", () => {
  it("a mutating tool invoked with an already-aborted signal is refused before dispatch and performs no mutation", async () => {
    const { transport, disk } = diskTransport({ "index.html": PAGE });
    const controller = new AbortController();
    controller.abort();

    const outcome = await toolRegistry.execute(
      "files.write",
      { path: "about.html", content: NEW_PAGE },
      { hasApproval: true, transport, signal: controller.signal },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("was not dispatched");
      expect(outcome.error).toContain("cancelled before this mutation started");
    }
    expect(vi.mocked(transport.writeFile)).not.toHaveBeenCalled();
    expect(disk.has("about.html")).toBe(false);
  });

  it("a read-only tool with an already-aborted signal fails via the execution deadline, not the dispatch guard, and never runs", async () => {
    const { transport } = diskTransport({ "index.html": PAGE });
    const controller = new AbortController();
    controller.abort();

    const outcome = await toolRegistry.execute(
      "files.read",
      { projectId: "p-test", path: "index.html" },
      { transport, signal: controller.signal },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("was aborted");
      expect(outcome.error).not.toContain("was not dispatched");
    }
    expect(vi.mocked(transport.readFile)).not.toHaveBeenCalled();
  });
});

describe("cancellation containment — child process kill wiring", () => {
  it("killChildOnAbort terminates a real spawned child (and its group) when the signal fires", async () => {
    const controller = new AbortController();
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      detached: true,
      stdio: "ignore",
    });
    killChildOnAbort(child, controller.signal);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    controller.abort();
    const outcome = await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);

    expect(outcome).not.toBeNull();
    expect(outcome?.signal).toBe("SIGTERM");
    // The process is really gone, not just signalled.
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });

  it("killChildOnAbort with an already-aborted signal terminates the child immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      detached: true,
      stdio: "ignore",
    });
    killChildOnAbort(child, controller.signal);

    const outcome = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);

    expect(outcome).not.toBeNull();
    expect(outcome?.signal).toBe("SIGTERM");
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });
});
