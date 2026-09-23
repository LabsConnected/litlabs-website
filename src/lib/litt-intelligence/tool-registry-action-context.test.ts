import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  actionToolResultFailed: vi.fn<(result: unknown) => string | null>(() => null),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  recordActionToolStarted: vi.fn(async () => ({})),
}));

vi.mock("@/lib/action-runtime/tool-runtime", () => runtimeMocks);

import { toolRegistry } from "./tool-registry";
import type { ToolExecutionContext } from "./tool-registry";
import type { LiTTToolDefinition } from "./types";

const context = {
  actionRunId: "run-composite",
  userId: "user-one",
  conversationId: "conversation-one",
  projectId: "project-one",
};

const transport = {
  projectId: "project-one",
  userId: "user-one",
  workspaceId: "workspace-one",
};

function registerTool(
  id: string,
  handler: (inputs: Record<string, unknown>, transport?: unknown, context?: ToolExecutionContext) => Promise<unknown>,
) {
  const definition: LiTTToolDefinition = {
    id,
    name: id,
    description: `test ${id}`,
    source: "internal",
    version: "1.0.0",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredCapabilities: [],
    requiredPermissions: [],
    risk: "low",
    permissionLevel: "read",
    approvalPolicy: {
      required: false,
      autoApproveReadOnly: false,
      requireExplicitForMutations: false,
      neverAllow: false,
    },
    timeoutMs: 1_000,
    idempotent: false,
    readOnly: false,
    enabled: true,
  };
  toolRegistry.register(definition, handler);
}

describe("toolRegistry.execute — trusted ActionExecutionContext propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    runtimeMocks.actionToolResultFailed.mockReturnValue(null);
    runtimeMocks.recordActionToolStarted.mockResolvedValue({});
    runtimeMocks.recordActionToolCompleted.mockResolvedValue({});
    runtimeMocks.recordActionToolFailed.mockResolvedValue({});
    runtimeMocks.markActionToolRunPersistenceDegraded.mockResolvedValue(undefined);
  });

  it("passes the parent context to handlers and records start/completion on that run", async () => {
    const handler = vi.fn(async (_inputs, _transport, executionContext?: ToolExecutionContext) => ({
      ok: true,
      actionRunId: executionContext?.actionContext?.actionRunId,
    }));
    registerTool("context.files.write", handler);

    const result = await toolRegistry.execute(
      "context.files.write",
      {},
      { transport, actionContext: context },
    );

    expect(result).toEqual({
      ok: true,
      result: { ok: true, actionRunId: "run-composite" },
    });
    expect(handler).toHaveBeenCalledWith(
      {},
      transport,
      expect.objectContaining({
        actionRunId: "run-composite",
        actionContext: context,
        userId: "user-one",
      }),
    );
    expect(runtimeMocks.recordActionToolStarted).toHaveBeenCalledWith(context, "context.files.write");
    expect(runtimeMocks.recordActionToolCompleted).toHaveBeenCalledWith(context, "context.files.write");
    expect(runtimeMocks.recordActionToolFailed).not.toHaveBeenCalled();
  });

  it("does not execute workspace tools when context/transport tenant identity conflicts", async () => {
    const handler = vi.fn(async (_inputs) => ({ ok: true }));
    registerTool("context.identity.mismatch", handler);

    const result = await toolRegistry.execute(
      "context.identity.mismatch",
      {},
      {
        transport: { ...transport, userId: "other-user" },
        actionContext: context,
      },
    );

    expect(result).toEqual({ ok: false, error: "action_context_user_mismatch" });
    expect(handler).not.toHaveBeenCalled();
    expect(runtimeMocks.recordActionToolStarted).not.toHaveBeenCalled();
  });

  it("does not execute untracked work when the started event cannot be persisted", async () => {
    const handler = vi.fn(async (_inputs) => ({ ok: true }));
    registerTool("context.unpersisted.start", handler);
    runtimeMocks.recordActionToolStarted.mockRejectedValue(new Error("event insert failed"));

    const result = await toolRegistry.execute(
      "context.unpersisted.start",
      {},
      { transport, actionContext: context },
    );

    expect(result).toEqual({ ok: false, error: "action_runtime_unavailable" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("records a structured domain failure on the same run while preserving the tool result", async () => {
    const handler = vi.fn(async (_inputs) => ({ success: false, error: "patch rejected" }));
    registerTool("context.domain.failure", handler);
    runtimeMocks.actionToolResultFailed.mockReturnValue("patch rejected");

    const result = await toolRegistry.execute(
      "context.domain.failure",
      {},
      { transport, actionContext: context },
    );

    expect(result).toEqual({ ok: true, result: { success: false, error: "patch rejected" } });
    expect(runtimeMocks.recordActionToolFailed).toHaveBeenCalledWith(context, "context.domain.failure", "patch rejected");
    expect(runtimeMocks.recordActionToolCompleted).not.toHaveBeenCalled();
  });

  it("returns an explicit post-execution reconciliation error instead of replaying the tool", async () => {
    const handler = vi.fn(async (_inputs) => ({ ok: true, mutated: true }));
    registerTool("context.persistence.after", handler);
    runtimeMocks.recordActionToolCompleted.mockRejectedValue(new Error("event insert failed"));

    const result = await toolRegistry.execute(
      "context.persistence.after",
      {},
      { transport, actionContext: context },
    );

    expect(result).toEqual({ ok: false, error: "ACTION_RUNTIME_PERSISTENCE_FAILED_AFTER_EXECUTION" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.markActionToolRunPersistenceDegraded).toHaveBeenCalledWith(context);
  });
});
