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
    deploymentStatus: "not_started",
    deploymentUrl: null,
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

/* ── Case E: independent runtime states ─────────────────────────── */

/**
 * Production evidence (Ember Roast V1 Acceptance): the workspace reported
 * "Preview ready" and "Terminal: disconnected" at the same time, while
 * having no repository. Preview readiness must never imply a connected
 * terminal, a healthy repository, a completed build, or a deployment.
 *
 * Root cause: previewStatus was assigned "ready" inside the workspace
 * verification block of buildCanonicalRuntimeContext, so preview state was
 * fabricated from workspace readiness rather than measured.
 */
/** The "- Fact: value" state lines, excluding RULE/IMPORTANT instruction prose. */
function reportedStates(block: string): string[] {
  return block.split(/\r?\n/).filter((l) => l.startsWith("- "));
}

describe("E. preview ready but terminal disconnected — states stay distinct", () => {
  const emberCtx = () => makeCtx({
    previewStatus: "ready" as const,
    terminalConnected: false,
    terminalStatus: "disconnected" as const,
    githubConnected: false,
    repository: null,
    branch: null,
    sourceType: "blank" as const,
  });

  it("reports preview ready and terminal disconnected as separate facts", () => {
    const block = buildRuntimeContextBlock(emberCtx());
    expect(block).toContain("Preview: ready");
    expect(block).toContain("Visible terminal UI: disconnected");
  });

  it("does not let preview readiness imply a connected terminal", () => {
    // Assert on the reported STATE lines, not on instruction prose (which
    // legitimately mentions connected/complete in order to forbid claiming them).
    const stateLines = reportedStates(buildRuntimeContextBlock(emberCtx()));
    expect(stateLines).toContain("- Visible terminal UI: disconnected (server alive)");
    expect(stateLines.join("\n")).not.toMatch(/terminal.*: connected/i);
  });

  it("does not let preview readiness imply a healthy repository", () => {
    const block = buildRuntimeContextBlock(emberCtx());
    expect(block).toContain("Repository: not connected");
  });

  it("does not let preview readiness imply a completed build or deployment", () => {
    // No reported STATE may assert that a build or deployment finished. The
    // deployment line reports its own (absent) state rather than inheriting
    // the preview's.
    const states = reportedStates(buildRuntimeContextBlock(emberCtx())).join("\n");
    expect(states).not.toMatch(/build (is |was )?(complete|successful|succeeded)/i);
    expect(states).toContain("- Deployment: not_started");
    expect(states).not.toMatch(/Deployment: (ready|live)/i);
    expect(states).toContain("- Live URL: none");
  });

  it("reports preview unavailable independently of a ready workspace", () => {
    // A verified workspace must not imply a ready preview.
    const block = buildRuntimeContextBlock(makeCtx({
      workspaceReady: true,
      workspaceExecutionAvailable: true,
      previewStatus: "unavailable",
    }));
    expect(block).toContain("Preview: unavailable");
  });

  it("tells the model that a static no-repository workspace has N/A repo checks", () => {
    const block = buildRuntimeContextBlock(emberCtx());
    expect(block).toMatch(/not applicable/i);
  });
});

/* ── Case K: preview ready, deployment absent ───────────────────── */

/**
 * The Ember Roast workspace showed "Preview ready" while nothing had ever
 * been deployed. Preview and deployment are separate fields with separate
 * lifecycles, and the model must be able to tell them apart.
 */
describe("K. preview ready but no deployment", () => {
  it("reports preview ready and deployment not started as separate states", () => {
    const block = buildRuntimeContextBlock(makeCtx({
      previewStatus: "ready",
      deploymentStatus: "not_started",
      deploymentUrl: null,
    }));
    expect(block).toContain("Preview: ready");
    expect(block).toContain("Deployment: not_started");
    expect(block).toContain("Live URL: none");
  });

  it("tells the model a ready preview is not a deployment", () => {
    const block = buildRuntimeContextBlock(makeCtx({
      previewStatus: "ready",
      deploymentStatus: "not_started",
    }));
    expect(block).toMatch(/preview is not a deployment|not deployed/i);
  });

  it("reports a live URL only when a deployment is ready", () => {
    const block = buildRuntimeContextBlock(makeCtx({
      previewStatus: "unavailable",
      deploymentStatus: "ready",
      deploymentUrl: "https://litlabs.example/sites/dep_1/",
    }));
    expect(block).toContain("Deployment: ready");
    expect(block).toContain("Live URL: https://litlabs.example/sites/dep_1/");
    // A ready deployment says nothing about the preview.
    expect(block).toContain("Preview: unavailable");
  });

  it("never reports a live URL for a failed deployment", () => {
    const block = buildRuntimeContextBlock(makeCtx({
      deploymentStatus: "failed",
      deploymentUrl: null,
    }));
    expect(block).toContain("Deployment: failed");
    expect(block).toContain("Live URL: none");
  });
});
