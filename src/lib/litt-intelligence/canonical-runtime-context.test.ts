import { describe, it, expect } from "vitest";

/**
 * Regression tests for canonical runtime context and branch consistency.
 *
 * Root causes being tested:
 * 1. Runtime context block did NOT include project_id, so the LLM could
 *    guess or use a stale project_id in tool calls.
 * 2. Branch was "unknown" in V1 agent loop (agent-loop.ts:271) while UI
 *    showed "main" — inconsistent sources.
 * 3. The runtime context block should instruct the LLM to use the
 *    provided project_id, not the repository name.
 */

import { buildRuntimeContextBlock, type CanonicalRuntimeContext } from "./canonical-runtime-context";

function makeCtx(overrides: Partial<CanonicalRuntimeContext> = {}): CanonicalRuntimeContext {
  return {
    projectId: "test-uuid-1234",
    projectName: "litlabs-website",
    workspaceId: "ws-1",
    workspaceReady: true,
    workspaceExecutionAvailable: true,
    workspaceRoot: "/workspace",
    terminalConnected: false,
    terminalStatus: "disconnected",
    terminalServerAlive: true,
    githubConnected: true,
    repository: "LabsConnected/litlabs-website",
    branch: "main",
    writePermission: true,
    previewStatus: "ready",
    availableTools: ["inspect_project_files", "read_file", "edit_file"],
    executionMode: "auto",
    model: null,
    provider: null,
    sourceType: "github",
    ...overrides,
  };
}

describe("buildRuntimeContextBlock — project identity", () => {
  it("includes project_id in the context block", () => {
    const block = buildRuntimeContextBlock(makeCtx());
    expect(block).toContain("Project ID: test-uuid-1234");
  });

  it("instructs LLM to use project_id for tool calls", () => {
    const block = buildRuntimeContextBlock(makeCtx());
    expect(block).toContain("project_id=\"test-uuid-1234\"");
    expect(block).toContain("Do NOT use the repository name");
  });

  it("does not include project_id instruction when projectId is null", () => {
    const block = buildRuntimeContextBlock(makeCtx({ projectId: null }));
    expect(block).not.toContain("project_id=\"");
  });
});

describe("buildRuntimeContextBlock — branch consistency", () => {
  it("shows branch from canonical context", () => {
    const block = buildRuntimeContextBlock(makeCtx({ branch: "main" }));
    expect(block).toContain("Branch: main");
  });

  it("shows 'none' when branch is null (not 'unknown')", () => {
    const block = buildRuntimeContextBlock(makeCtx({ branch: null }));
    expect(block).toContain("Branch: none");
    expect(block).not.toContain("Branch: unknown");
  });
});

describe("buildRuntimeContextBlock — workspace execution", () => {
  it("reports workspace execution as available", () => {
    const block = buildRuntimeContextBlock(makeCtx({ workspaceExecutionAvailable: true }));
    expect(block).toContain("Workspace execution: available");
  });

  it("reports workspace execution as not available", () => {
    const block = buildRuntimeContextBlock(makeCtx({ workspaceExecutionAvailable: false }));
    expect(block).toContain("Workspace execution: not available");
  });

  it("includes execution mode", () => {
    const block = buildRuntimeContextBlock(makeCtx({ executionMode: "auto" }));
    expect(block).toContain("Execution mode: auto");
  });

  it("includes AUTO mode approval instructions", () => {
    const block = buildRuntimeContextBlock(makeCtx({ executionMode: "auto" }));
    expect(block).toContain("AUTO mode");
    expect(block).toContain("auto-approved");
  });

  it("includes ACT mode approval instructions", () => {
    const block = buildRuntimeContextBlock(makeCtx({ executionMode: "act" }));
    expect(block).toContain("ACT mode");
    expect(block).toContain("explicit user approval");
  });

  it("includes PLAN mode approval instructions", () => {
    const block = buildRuntimeContextBlock(makeCtx({ executionMode: "plan" }));
    expect(block).toContain("PLAN mode");
    expect(block).toContain("read-only inspection only");
  });
});
