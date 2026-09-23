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
  recordBrowserToolExecution: vi.fn(),
  markBrowserRunPersistenceDegraded: vi.fn(),
  resolveBrowserActionRun: vi.fn(),
}));

vi.mock("@/lib/action-runtime/browser-runtime", () => runtimeMocks);

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
    runtimeMocks.recordBrowserToolExecution.mockResolvedValue({ id: "run-one" });
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
    expect(runtimeMocks.recordBrowserToolExecution).toHaveBeenCalledWith({
      actionRunId: "run-one",
      userId: "user-one",
      browserSessionId: "session-one",
      toolId: "browser.fake",
      result: { outcome: "completed" },
    });
    expect(runtimeMocks.resolveBrowserActionRun).not.toHaveBeenCalled();
  });

  it("records a thrown tool error as a failed execution on the same run", async () => {
    const handler: TestHandler = async (_inputs) => {
      throw new Error("click timed out");
    };
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);

    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionRunId: "run-one" });

    expect(result.ok).toBe(false);
    expect(runtimeMocks.recordBrowserToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRunId: "run-one",
        toolId: "browser.fake",
        result: expect.objectContaining({ outcome: "failed" }),
      }),
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

  it("keeps the real result but marks the run degraded when post-execution persistence fails", async () => {
    runtimeMocks.recordBrowserToolExecution.mockRejectedValue(new Error("event insert failed"));
    const handler: TestHandler = async (_inputs) => ({ navigated: true });
    toolRegistry.register(fakeBrowserTool("browser.fake"), handler);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await toolRegistry.execute("browser.fake", browserInputs, { actionRunId: "run-one" });

    // The browser action already executed — reporting failure would invite a
    // retry of a non-idempotent action. The degradation is logged + stamped.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toEqual({ navigated: true });
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
});
