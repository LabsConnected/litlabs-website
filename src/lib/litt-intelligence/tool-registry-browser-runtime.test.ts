// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toolRegistry } from "./tool-registry";
import type { LiTTToolDefinition } from "./types";

/**
 * Action Runtime contract for browser tool calls: one user task = one
 * ActionRun, and durable event persistence is runtime truth, not telemetry.
 * These tests pin how ToolRegistry.execute() resolves run identity and how
 * it surfaces persistence failures instead of silently swallowing them.
 */

const runtimeMocks = vi.hoisted(() => ({
  recordBrowserToolStarted: vi.fn(),
  recordBrowserToolCompleted: vi.fn(),
  recordBrowserToolFailed: vi.fn(),
  markBrowserRunPersistenceDegraded: vi.fn(),
  resolveBrowserActionRun: vi.fn(),
  attachBrowserSession: vi.fn(),
  findActiveBrowserActionRun: vi.fn(),
  startBrowserActionRun: vi.fn(),
  failBrowserActionRun: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  getOrReuseAgentBrowserSession: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
}));

vi.mock("@/lib/action-runtime/browser-runtime", () => runtimeMocks);
vi.mock("./browser-agent", () => agentMocks);
vi.mock("@/lib/projects/project-repository", () => projectMocks);

function fakeBrowserTool(id: string): LiTTToolDefinition {
  return {
    id,
    name: id,
    description: `${id} (test double)`,
    source: "internal",
    version: "1.0.0",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredCapabilities: [],
    requiredPermissions: [],
    risk: "low",
    approvalPolicy: {
      required: false,
      autoApproveReadOnly: false,
      requireExplicitForMutations: false,
      neverAllow: false,
    },
    timeoutMs: 5_000,
    idempotent: false,
    readOnly: false,
    permissionLevel: "read",
    enabled: true,
  };
}

type TestHandler = (inputs: Record<string, unknown>, transport?: unknown) => Promise<unknown>;

const browserInputs = { sessionId: "session-one", userId: "user-one" };

describe("toolRegistry.execute — browser ActionRuntime recording", () => {
  beforeEach(() => {
    toolRegistry.clear();
    vi.clearAllMocks();
    runtimeMocks.recordBrowserToolStarted.mockResolvedValue({ id: "run-one" });
    runtimeMocks.recordBrowserToolCompleted.mockResolvedValue({ id: "run-one" });
    runtimeMocks.recordBrowserToolFailed.mockResolvedValue({ id: "run-one" });
    runtimeMocks.markBrowserRunPersistenceDegraded.mockResolvedValue(undefined);
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records started/completed against the supplied actionRunId", async () => {
    const handler: TestHandler = async (_inputs) => ({ navigated: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionRunId: "run-one" });

    expect(result.ok).toBe(true);
    expect(runtimeMocks.recordBrowserToolStarted).toHaveBeenCalledWith({
      actionRunId: "run-one",
      userId: "user-one",
      browserSessionId: "session-one",
      toolId: "browser.fake",
    });
    expect(runtimeMocks.recordBrowserToolCompleted).toHaveBeenCalledWith({
      actionRunId: "run-one",
      userId: "user-one",
      browserSessionId: "session-one",
      toolId: "browser.fake",
    });
    expect(runtimeMocks.resolveBrowserActionRun).not.toHaveBeenCalled();
  });

  it("ignores a model-supplied actionRunId and trusts only the execution option", async () => {
    const handler: TestHandler = async (_inputs) => ({ navigated: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute(
      "browser.fake",
      { ...browserInputs, actionRunId: "model-controlled-run" },
      { actionRunId: "server-run" },
    );

    expect(result.ok).toBe(true);
    expect(runtimeMocks.recordBrowserToolStarted).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "server-run" }),
    );
    expect(runtimeMocks.recordBrowserToolStarted).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "model-controlled-run" }),
    );
  });

  it("records a thrown tool error as a failed execution on the same run", async () => {
    const handler: TestHandler = async (_inputs) => {
      throw new Error("click timed out");
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionRunId: "run-one" });

    expect(result.ok).toBe(false);
    expect(runtimeMocks.recordBrowserToolFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRunId: "run-one",
        toolId: "browser.fake",
      }),
      expect.any(Error),
    );
  });

  it("resolves run identity through the attached session when no actionRunId is supplied", async () => {
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue({ id: "run-attached" });
    const handler: TestHandler = async (_inputs) => ({ ok: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs);

    expect(result.ok).toBe(true);
    expect(runtimeMocks.resolveBrowserActionRun).toHaveBeenCalledWith("user-one", { browserSessionId: "session-one" });
    expect(runtimeMocks.recordBrowserToolStarted).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "run-attached", browserSessionId: "session-one" }),
    );
  });

  it("does not execute the browser action when the started event cannot be persisted", async () => {
    runtimeMocks.recordBrowserToolStarted.mockRejectedValue(new Error("db write lost"));
    let handlerCalled = false;
    const handler: TestHandler = async (_inputs) => {
      handlerCalled = true;
      return { shouldNeverRun: true };
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionRunId: "run-one" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("action_runtime_unavailable");
    expect(handlerCalled).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[action-runtime] browser action start could not be persisted; tool call aborted",
      expect.objectContaining({ runId: "run-one", toolId: "browser.fake" }),
    );
  });

  it("returns an explicit reconciliation error when post-execution persistence fails", async () => {
    runtimeMocks.recordBrowserToolCompleted.mockRejectedValue(new Error("event insert failed"));
    let handlerCalls = 0;
    const handler: TestHandler = async (_inputs) => {
      handlerCalls += 1;
      return { navigated: true };
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionRunId: "run-one" });

    // The browser action already executed; callers see a durable-truth
    // reconciliation error, but the registry never replays it automatically.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("ACTION_RUNTIME_PERSISTENCE_FAILED_AFTER_EXECUTION");
    expect(handlerCalls).toBe(1);
    expect(runtimeMocks.markBrowserRunPersistenceDegraded).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "run-one", browserSessionId: "session-one" }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[action-runtime] browser action result could not be persisted after execution",
      expect.objectContaining({ runId: "run-one", toolId: "browser.fake" }),
    );
  });

  it("warns instead of failing silently when the session has no attached run", async () => {
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue(null);
    const handler: TestHandler = async (_inputs) => ({ ok: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await toolRegistry.execute("browser.fake", browserInputs);

    expect(result.ok).toBe(true);
    expect(runtimeMocks.recordBrowserToolStarted).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[action-runtime] browser session is not attached to any run; tool events will not be recorded",
      expect.objectContaining({ toolId: "browser.fake", browserSessionId: "session-one" }),
    );
  });

  it("uses the trusted ActionExecutionContext without any run discovery", async () => {
    const handler: TestHandler = async (_inputs) => ({ navigated: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const actionContext = { actionRunId: "run-one", userId: "user-one", conversationId: "conv-one" };
    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionContext });

    expect(result.ok).toBe(true);
    expect(runtimeMocks.recordBrowserToolStarted).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "run-one", userId: "user-one" }),
    );
    expect(runtimeMocks.resolveBrowserActionRun).not.toHaveBeenCalled();
  });

  it("keeps two concurrent tools on the same ActionExecutionContext run", async () => {
    const handler: TestHandler = async (_inputs) => ({ done: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);
    toolRegistry.register(fakeBrowserTool("browser.other"), handler);

    const actionContext = { actionRunId: "run-one", userId: "user-one" };
    const a = await toolRegistry.execute("browser.fake", browserInputs, { actionContext });
    const b = await toolRegistry.execute("browser.other", browserInputs, { actionContext });

    expect(a.ok && b.ok, JSON.stringify({ a, b })).toBe(true);
    for (const call of runtimeMocks.recordBrowserToolStarted.mock.calls) {
      expect(call[0]).toMatchObject({ actionRunId: "run-one", userId: "user-one" });
    }
    expect(runtimeMocks.resolveBrowserActionRun).not.toHaveBeenCalled();
  });

  it("rejects a model-supplied userId that disagrees with the trusted context", async () => {
    let handlerCalls = 0;
    const handler: TestHandler = async (_inputs) => {
      handlerCalls += 1;
      return {};
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute(
      "browser.fake",
      { sessionId: "session-one", userId: "user-two" },
      { actionContext: { actionRunId: "run-one", userId: "user-one" } },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("browser_user_mismatch");
    expect(handlerCalls).toBe(0);
    expect(runtimeMocks.recordBrowserToolStarted).not.toHaveBeenCalled();
  });

  it("aborts execution when the started event cannot be persisted (no untracked actions)", async () => {
    runtimeMocks.recordBrowserToolStarted.mockRejectedValue(new Error("event insert failed"));
    let handlerCalls = 0;
    const handler: TestHandler = async (_inputs) => {
      handlerCalls += 1;
      return {};
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs, {
      actionContext: { actionRunId: "run-one", userId: "user-one" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("action_runtime_unavailable");
    expect(handlerCalls).toBe(0);
  });

  it("rejects new actions on a terminal parent run", async () => {
    runtimeMocks.recordBrowserToolStarted.mockRejectedValue(
      Object.assign(new Error("Cannot mutate a terminal action run"), { code: "ACTION_RUN_TERMINAL_IMMUTABLE" }),
    );
    let handlerCalls = 0;
    const handler: TestHandler = async (_inputs) => {
      handlerCalls += 1;
      return {};
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs, {
      actionContext: { actionRunId: "run-one", userId: "user-one" },
    });

    expect(result.ok).toBe(false);
    expect(handlerCalls).toBe(0);
    expect(runtimeMocks.recordBrowserToolCompleted).not.toHaveBeenCalled();
  });

  it("emits browser.action.failed on the same run when the handler throws", async () => {
    const handler: TestHandler = async (_inputs) => {
      throw new Error("provider exploded");
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs, {
      actionContext: { actionRunId: "run-one", userId: "user-one" },
    });

    expect(result.ok, JSON.stringify(result)).toBe(false);
    expect(runtimeMocks.recordBrowserToolStarted).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "run-one", toolId: "browser.fake" }),
    );
    expect(runtimeMocks.recordBrowserToolFailed).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "run-one", toolId: "browser.fake" }),
      expect.any(Error),
    );
    expect(runtimeMocks.recordBrowserToolCompleted).not.toHaveBeenCalled();
  });

  it("emits browser.action.failed when the handler times out", async () => {
    const tool = { ...fakeBrowserTool("browser.slow"), timeoutMs: 20 };
    const handler: TestHandler = (_inputs) => new Promise(() => {});
    toolRegistry.register(tool, handler);

    const result = await toolRegistry.execute("browser.slow", browserInputs, {
      actionContext: { actionRunId: "run-one", userId: "user-one" },
    });

    expect(result.ok).toBe(false);
    expect(runtimeMocks.recordBrowserToolFailed).toHaveBeenCalledWith(
      expect.objectContaining({ actionRunId: "run-one", toolId: "browser.slow" }),
      expect.any(Error),
    );
  });
});

describe("browser.start_session — trusted execution context", () => {
  const attachedRun = { id: "run-one", status: "working", kind: "browser", userId: "user-one" };

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue(attachedRun);
    runtimeMocks.attachBrowserSession.mockResolvedValue(attachedRun);
    runtimeMocks.findActiveBrowserActionRun.mockResolvedValue(null);
    runtimeMocks.startBrowserActionRun.mockResolvedValue({ id: "run-new", status: "queued" });
    runtimeMocks.failBrowserActionRun.mockResolvedValue({ id: "run-one", status: "failed" });
    agentMocks.getOrReuseAgentBrowserSession.mockResolvedValue({
      ok: true,
      session: { id: "session-one", browserbaseSessionId: "provider-one" },
    });
    projectMocks.getProject.mockResolvedValue({ id: "project-one" });
  });

  async function freshRegistry() {
    // A fresh module instance re-runs registerInternalTools() so the real
    // browser.start_session lazy handler is registered.
    vi.resetModules();
    const mod = await import("./tool-registry");
    return mod.toolRegistry;
  }

  it("uses the context ActionRun with no run discovery and no run creation", async () => {
    const registry = await freshRegistry();

    const result = await registry.execute(
      "browser.start_session",
      { userId: "user-one", task: "check the deploy" },
      { actionContext: { actionRunId: "run-one", userId: "user-one", conversationId: "conv-one" } },
    );

    expect(result.ok).toBe(true);
    const payload = result.ok ? (result.result as Record<string, unknown>) : {};
    expect(payload.actionRunId).toBe("run-one");
    expect(runtimeMocks.resolveBrowserActionRun).toHaveBeenCalledWith("user-one", { actionRunId: "run-one", browserSessionId: undefined });
    expect(runtimeMocks.findActiveBrowserActionRun).not.toHaveBeenCalled();
    expect(runtimeMocks.startBrowserActionRun).not.toHaveBeenCalled();
    expect(runtimeMocks.attachBrowserSession).toHaveBeenCalledWith(attachedRun, expect.objectContaining({ id: "session-one" }));
  });

  it("rejects a model-supplied userId that disagrees with the trusted context", async () => {
    const registry = await freshRegistry();

    const result = await registry.execute(
      "browser.start_session",
      { userId: "user-two", task: "check the deploy" },
      { actionContext: { actionRunId: "run-one", userId: "user-one" } },
    );

    expect(result.ok, JSON.stringify(result)).toBe(false);
    if (!result.ok) expect(result.error).toBe("browser_user_mismatch");
    expect(agentMocks.getOrReuseAgentBrowserSession).not.toHaveBeenCalled();
  });

  it("refuses to provision a session for a terminal parent run", async () => {
    const registry = await freshRegistry();
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue({ ...attachedRun, status: "completed" });

    const result = await registry.execute(
      "browser.start_session",
      { userId: "user-one", task: "check the deploy" },
      { actionContext: { actionRunId: "run-one", userId: "user-one" } },
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const terminalPayload = result.ok ? (result.result as Record<string, unknown>) : {};
    expect(terminalPayload.error).toBe("action_run_terminal");
    expect(agentMocks.getOrReuseAgentBrowserSession).not.toHaveBeenCalled();
  });

  it("rejects an unowned projectId on the legacy fallback boundary", async () => {
    const registry = await freshRegistry();
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue(null);
    projectMocks.getProject.mockResolvedValue(null);

    const result = await registry.execute(
      "browser.start_session",
      { userId: "user-one", task: "check", projectId: "foreign-project" },
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const projectPayload = result.ok ? (result.result as Record<string, unknown>) : {};
    expect(projectPayload.error).toBe("project_not_found");
    expect(runtimeMocks.startBrowserActionRun).not.toHaveBeenCalled();
    expect(agentMocks.getOrReuseAgentBrowserSession).not.toHaveBeenCalled();
  });

  it("falls back to find-or-create only when no execution context exists", async () => {
    const registry = await freshRegistry();
    runtimeMocks.resolveBrowserActionRun.mockResolvedValue(null);
    runtimeMocks.attachBrowserSession.mockResolvedValue({ id: "run-new", status: "working" });

    const result = await registry.execute(
      "browser.start_session",
      { userId: "user-one", task: "check" },
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(runtimeMocks.startBrowserActionRun).toHaveBeenCalledTimes(1);
    const payload = result.ok ? (result.result as Record<string, unknown>) : {};
    expect(payload.actionRunId).toBe("run-new");
  });
});
