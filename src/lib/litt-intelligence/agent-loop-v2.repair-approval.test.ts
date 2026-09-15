import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for a P0 approval-bypass finding in the autonomous
 * build-fix repair loop.
 *
 * createAutonomousRepairCallback() previously called
 *   toolRegistry.execute(toolCall.toolId, toolCall.inputs, { hasApproval: true, ... })
 * unconditionally for every tool call the model made while repairing a
 * failed build/typecheck/test — including SENSITIVE_ACTIONS such as
 * files.delete, git.push and project.deploy, which normally require a
 * real human approval (or, in AUTO mode, are explicitly excluded from the
 * auto-approve safe set) in both ACT and AUTO execution modes.
 *
 * That meant a model repairing a build could delete workspace files or
 * trigger a deploy with zero approval gate, in any execution mode,
 * regardless of what the user actually authorized.
 *
 * The fix routes every repair-loop tool call through the same
 * PermissionEngine AUTO-mode check the rest of the loop uses: routine
 * reversible edits (files.write, apply_patch, files.mkdir, files.rename,
 * git.commit) still execute, but sensitive actions are refused instead of
 * silently approved.
 */

const { callLLMWithTools, execute } = vi.hoisted(() => ({
  callLLMWithTools: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("./llm-tool-calling", async () => {
  const actual = await vi.importActual<typeof import("./llm-tool-calling")>("./llm-tool-calling");
  return { ...actual, callLLMWithTools };
});

vi.mock("./tool-registry", () => ({
  toolRegistry: {
    execute,
    get: (id: string) => ({ id, readOnly: false, enabled: true }),
  },
}));

import { createAutonomousRepairCallback } from "./agent-loop-v2";
import type { WorkspaceTransport } from "./workspace-transport";
import type { ToolDefinition } from "./llm-tool-calling";

const fakeTransport = { userId: "u1", projectId: "p1", workspaceId: "ws1" } as unknown as WorkspaceTransport;

const toolDefs: ToolDefinition[] = [
  { id: "files.write", description: "write", inputSchema: { type: "object", properties: {} } },
  { id: "files.delete", description: "delete", inputSchema: { type: "object", properties: {} } },
];

beforeEach(() => {
  callLLMWithTools.mockReset();
  execute.mockReset();
  execute.mockResolvedValue({ ok: true, result: { success: true } });
});

describe("createAutonomousRepairCallback — approval boundary", () => {
  it("refuses a sensitive action (files.delete) instead of auto-approving it", async () => {
    callLLMWithTools
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "tc1", toolId: "files.delete", inputs: { path: "important.ts" } }],
        finishReason: "tool_calls",
        model: "test",
      })
      .mockResolvedValueOnce({ text: "done", toolCalls: [], finishReason: "stop", model: "test" });

    const repair = createAutonomousRepairCallback(fakeTransport, "system prompt", toolDefs);
    const ok = await repair(1, "TypeError: something failed");

    expect(ok).toBe(true);
    // The sensitive tool must never reach toolRegistry.execute.
    expect(execute).not.toHaveBeenCalled();
  });

  it("still allows a routine reversible edit (files.write) to execute", async () => {
    callLLMWithTools
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "tc1", toolId: "files.write", inputs: { path: "a.ts", content: "fixed" } }],
        finishReason: "tool_calls",
        model: "test",
      })
      .mockResolvedValueOnce({ text: "done", toolCalls: [], finishReason: "stop", model: "test" });

    const repair = createAutonomousRepairCallback(fakeTransport, "system prompt", toolDefs);
    const ok = await repair(1, "TypeError: something failed");

    expect(ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("files.write", { path: "a.ts", content: "fixed" }, expect.objectContaining({ hasApproval: true }));
  });
});
