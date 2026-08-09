import { describe, it, expect } from "vitest";
import { buildRuntimeContextBlock, type CanonicalRuntimeContext } from "@/lib/litt-intelligence/canonical-runtime-context";

describe("buildRuntimeContextBlock", () => {
  it("includes all runtime fields", () => {
    const ctx: CanonicalRuntimeContext = {
      projectId: "proj-123",
      projectName: "litlabs-website",
      workspaceId: "ws-123",
      workspaceReady: true,
      workspaceExecutionAvailable: true,
      workspaceRoot: "/workspace/proj-123",
      terminalConnected: true,
      terminalStatus: "connected",
      terminalServerAlive: true,
      githubConnected: true,
      repository: "LabsConnected/litlabs-website",
      branch: "main",
      writePermission: true,
      previewStatus: "ready",
      availableTools: ["repository", "terminal"],
      executionMode: "act",
      model: null,
      provider: null,
      sourceType: "github",
    };

    const block = buildRuntimeContextBlock(ctx);

    expect(block).toContain("litlabs-website");
    expect(block).toContain("Workspace: ready");
    expect(block).toContain("Workspace execution: available");
    expect(block).toContain("LabsConnected/litlabs-website");
    expect(block).toContain("Branch: main");
    expect(block).toContain("Write permission: allowed");
    expect(block).toContain("Execution mode: act");
  });

  it("never contains DEMO", () => {
    const ctx: CanonicalRuntimeContext = {
      projectId: "proj-123",
      projectName: "litlabs-website",
      workspaceId: "ws-123",
      workspaceReady: true,
      workspaceExecutionAvailable: true,
      workspaceRoot: "/workspace/proj-123",
      terminalConnected: true,
      terminalStatus: "connected",
      terminalServerAlive: true,
      githubConnected: true,
      repository: "LabsConnected/litlabs-website",
      branch: "main",
      writePermission: true,
      previewStatus: "ready",
      availableTools: ["repository", "terminal"],
      executionMode: "act",
      model: null,
      provider: null,
      sourceType: "github",
    };

    const block = buildRuntimeContextBlock(ctx);
    expect(block).not.toContain("DEMO");
    expect(block).not.toContain("demo");
  });

  it("handles null project gracefully", () => {
    const ctx: CanonicalRuntimeContext = {
      projectId: null,
      projectName: null,
      workspaceId: null,
      workspaceReady: false,
      workspaceExecutionAvailable: false,
      workspaceRoot: null,
      terminalConnected: false,
      terminalStatus: "disconnected",
      terminalServerAlive: false,
      githubConnected: false,
      repository: null,
      branch: null,
      writePermission: false,
      previewStatus: "unknown",
      availableTools: [],
      executionMode: "act",
      model: null,
      provider: null,
      sourceType: null,
    };

    const block = buildRuntimeContextBlock(ctx);
    expect(block).toContain("Project: none");
    expect(block).toContain("Workspace: not ready");
    expect(block).toContain("Workspace execution: not available");
    expect(block).toContain("No workspace execution or terminal");
  });

  it("instructs LLM about terminal server alive but no session", () => {
    const ctx: CanonicalRuntimeContext = {
      projectId: "proj-123",
      projectName: "litlabs-website",
      workspaceId: null,
      workspaceReady: false,
      workspaceExecutionAvailable: false,
      workspaceRoot: null,
      terminalConnected: false,
      terminalStatus: "disconnected",
      terminalServerAlive: true,
      githubConnected: true,
      repository: "LabsConnected/litlabs-website",
      branch: "main",
      writePermission: false,
      previewStatus: "unknown",
      availableTools: ["terminal"],
      executionMode: "act",
      model: null,
      provider: null,
      sourceType: "github",
    };

    const block = buildRuntimeContextBlock(ctx);
    expect(block).toContain("server alive");
  });

  it("distinguishes workspace execution available from terminal UI disconnected", () => {
    const ctx: CanonicalRuntimeContext = {
      projectId: "proj-123",
      projectName: "litlabs-website",
      workspaceId: "ws-123",
      workspaceReady: true,
      workspaceExecutionAvailable: true,
      workspaceRoot: "/workspace/proj-123",
      terminalConnected: false,
      terminalStatus: "disconnected",
      terminalServerAlive: true,
      githubConnected: true,
      repository: "LabsConnected/litlabs-website",
      branch: "main",
      writePermission: true,
      previewStatus: "ready",
      availableTools: ["repository"],
      executionMode: "act",
      model: null,
      provider: null,
      sourceType: "github",
    };

    const block = buildRuntimeContextBlock(ctx);
    expect(block).toContain("Workspace execution: available");
    expect(block).toContain("Visible terminal UI: disconnected");
    expect(block).toContain("Workspace execution is available even though the visible terminal UI is disconnected");
    expect(block).toContain("Do NOT say 'terminal is not connected'");
  });
});
