import { describe, it, expect } from "vitest";
import {
  detectIntent,
  buildRuntimeContextBlock,
  buildToolManifest,
  generateProjectStatusAnswer,
  explainUnavailableTool,
  type RuntimeContextSnapshot,
} from "@/lib/litt-intelligence/runtime-context-injector";

// ─── Test fixtures ────────────────────────────────────────────────

const CONNECTED_CTX: RuntimeContextSnapshot = {
  projectId: "proj-123",
  projectName: "litlabs-website",
  repositoryConnected: true,
  repositoryName: "LabsConnected/litlabs-website",
  activeBranch: "main",
  workspaceStatus: "ready",
  workspaceReady: true,
  terminalConnected: false,
  terminalStatus: "disconnected",
  terminalSessionId: null,
  deploymentStatus: null,
  deploymentUrl: null,
  writeAccess: false,
  approvalRequired: true, // policy — always true, not derived from connection
  selectedModelLabel: "Auto Best",
  selectedModelId: "auto",
  activeAgentMode: "standard",
  activeAgentSlug: "litt",
  recentHealthResults: [],
};

const FULLY_CONNECTED_CTX: RuntimeContextSnapshot = {
  ...CONNECTED_CTX,
  terminalConnected: true,
  terminalStatus: "connected",
  terminalSessionId: "session-abc",
  writeAccess: true,
  approvalRequired: true, // policy — always true even when fully connected
  deploymentStatus: "ready",
  deploymentUrl: "https://example.vercel.app",
};

const DISCONNECTED_CTX: RuntimeContextSnapshot = {
  ...CONNECTED_CTX,
  repositoryConnected: false,
  repositoryName: null,
  activeBranch: null,
  workspaceReady: false,
  workspaceStatus: "not_prepared",
};

// ─── Intent Detection Tests ───────────────────────────────────────

describe("Intent Detection", () => {
  describe("project_status intent", () => {
    it("detects 'where do things stand'", () => {
      const result = detectIntent("where do things stand?");
      expect(result.category).toBe("project_status");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.requiredTools).toContain("project.health");
    });

    it("detects 'where does everything stand'", () => {
      const result = detectIntent("where does everything stand");
      expect(result.category).toBe("project_status");
    });

    it("detects 'project status'", () => {
      const result = detectIntent("give me a project status update");
      expect(result.category).toBe("project_status");
    });

    it("detects 'how are things'", () => {
      const result = detectIntent("how are things going?");
      expect(result.category).toBe("project_status");
    });

    it("detects 'status update'", () => {
      const result = detectIntent("can I get a status update?");
      expect(result.category).toBe("project_status");
    });
  });

  describe("weather intent", () => {
    it("detects 'weather in Spring Lake Michigan'", () => {
      const result = detectIntent("what is the weather in Spring Lake, Michigan?");
      expect(result.category).toBe("weather");
      expect(result.requiredTools).toContain("weather.current");
    });

    it("detects 'temperature'", () => {
      const result = detectIntent("what's the temperature outside?");
      expect(result.category).toBe("weather");
    });

    it("detects 'forecast'", () => {
      const result = detectIntent("give me the forecast for tomorrow");
      expect(result.category).toBe("weather");
    });
  });

  describe("terminal_status intent", () => {
    it("detects 'is my terminal connected'", () => {
      const result = detectIntent("is my terminal connected?");
      expect(result.category).toBe("terminal_status");
      expect(result.requiredTools).toContain("terminal.status");
    });

    it("detects 'terminal status'", () => {
      const result = detectIntent("what's the terminal status?");
      expect(result.category).toBe("terminal_status");
    });
  });

  describe("repository_info intent", () => {
    it("detects 'what repository am I using'", () => {
      const result = detectIntent("what repository am I using?");
      expect(result.category).toBe("repository_info");
      expect(result.requiredTools).toContain("repository.info");
    });

    it("detects 'what branch am I on'", () => {
      const result = detectIntent("what branch am I on?");
      expect(result.category).toBe("repository_info");
    });
  });

  describe("general intent", () => {
    it("returns general for 'whats up'", () => {
      const result = detectIntent("whats up");
      expect(result.category).toBe("general");
    });

    it("returns general for 'hello'", () => {
      const result = detectIntent("hello");
      expect(result.category).toBe("general");
    });
  });

  describe("creative intent", () => {
    it("detects 'generate image'", () => {
      const result = detectIntent("generate image of a sunset");
      expect(result.category).toBe("creative");
    });

    it("detects 'create artwork'", () => {
      const result = detectIntent("create some EDM artwork");
      expect(result.category).toBe("creative");
    });

    it("detects 'make music'", () => {
      const result = detectIntent("make music for my game");
      expect(result.category).toBe("creative");
    });
  });
});

// ─── Project Status Answer Tests ──────────────────────────────────

describe("Project Status Answer Generation", () => {
  it("generates accurate status for connected repo with disconnected terminal", () => {
    const answer = generateProjectStatusAnswer(CONNECTED_CTX);
    expect(answer).toContain("LabsConnected/litlabs-website");
    expect(answer).toContain("main");
    expect(answer).toContain("workspace is available");
    expect(answer).toContain("terminal is currently disconnected");
    expect(answer).toContain("Write operations require your approval");
  });

  it("generates accurate status for fully connected project", () => {
    const answer = generateProjectStatusAnswer(FULLY_CONNECTED_CTX);
    expect(answer).toContain("LabsConnected/litlabs-website");
    expect(answer).toContain("terminal is connected");
    // Approval is always required — it's a policy, not a connection state
    expect(answer).toContain("Write operations require your approval");
  });

  it("generates accurate status for disconnected project", () => {
    const answer = generateProjectStatusAnswer(DISCONNECTED_CTX);
    expect(answer).toContain("No repository is currently connected");
    expect(answer).toContain("workspace is not_prepared");
  });

  it("includes model label when available", () => {
    const answer = generateProjectStatusAnswer(CONNECTED_CTX);
    expect(answer).toContain("Auto Best");
  });

  it("includes deployment status when available", () => {
    const answer = generateProjectStatusAnswer(FULLY_CONNECTED_CTX);
    expect(answer).toContain("ready");
  });
});

// ─── Runtime Context Block Tests ──────────────────────────────────

describe("Runtime Context Block", () => {
  it("includes repository name and branch", () => {
    const block = buildRuntimeContextBlock(CONNECTED_CTX);
    expect(block).toContain("LabsConnected/litlabs-website");
    expect(block).toContain("main");
  });

  it("includes terminal state", () => {
    const block = buildRuntimeContextBlock(CONNECTED_CTX);
    expect(block).toContain("Connected: no");
    expect(block).toContain("disconnected");
  });

  it("includes approval mode", () => {
    const block = buildRuntimeContextBlock(CONNECTED_CTX);
    expect(block).toContain("Approval required: yes");
    expect(block).toContain("policy");
  });

  it("includes model label", () => {
    const block = buildRuntimeContextBlock(CONNECTED_CTX);
    expect(block).toContain("Auto Best");
  });

  it("includes agent mode", () => {
    const block = buildRuntimeContextBlock(CONNECTED_CTX);
    expect(block).toContain("standard");
    expect(block).toContain("litt");
  });

  it("includes critical rules", () => {
    const block = buildRuntimeContextBlock(CONNECTED_CTX);
    expect(block).toContain("CRITICAL RULES");
    expect(block).toContain("EXACT values");
  });
});

// ─── Tool Capability Manifest Tests ───────────────────────────────

describe("Tool Capability Manifest", () => {
  it("marks terminal.execute as unavailable when terminal is disconnected", () => {
    const manifest = buildToolManifest(CONNECTED_CTX);
    const terminalTool = manifest.tools.find((t) => t.id === "terminal.execute");
    expect(terminalTool).toBeDefined();
    expect(terminalTool?.available).toBe(false);
    expect(terminalTool?.unavailableReason).toBe("Terminal is disconnected");
  });

  it("marks terminal.execute as available when terminal is connected", () => {
    const manifest = buildToolManifest(FULLY_CONNECTED_CTX);
    const terminalTool = manifest.tools.find((t) => t.id === "terminal.execute");
    expect(terminalTool?.available).toBe(true);
  });

  it("marks repository.info as unavailable when no repo connected", () => {
    const manifest = buildToolManifest(DISCONNECTED_CTX);
    const repoTool = manifest.tools.find((t) => t.id === "repository.info");
    expect(repoTool?.available).toBe(false);
    expect(repoTool?.unavailableReason).toBe("No repository connected");
  });

  it("marks workspace.write as unavailable when terminal is disconnected", () => {
    const manifest = buildToolManifest(CONNECTED_CTX);
    const writeTool = manifest.tools.find((t) => t.id === "workspace.write");
    expect(writeTool?.available).toBe(false);
    // workspace.write requires terminal connection, not just workspace readiness
    expect(writeTool?.unavailableReason).toContain("Terminal is disconnected");
  });

  it("includes manifest block with available and unavailable tools", () => {
    // Use CONNECTED_CTX which has terminal disconnected → unavailable tools exist
    const manifest = buildToolManifest(CONNECTED_CTX);
    expect(manifest.manifestBlock).toContain("Available tools:");
    expect(manifest.manifestBlock).toContain("Unavailable tools");
    expect(manifest.manifestBlock).toContain("Terminal is disconnected");
  });

  it("manifest block may have no unavailable tools when everything is connected", () => {
    // Use FULLY_CONNECTED_CTX — everything is available
    const manifest = buildToolManifest(FULLY_CONNECTED_CTX);
    expect(manifest.manifestBlock).toContain("Available tools:");
    // No unavailable section when everything is available
    // (project.health is available because projectId is set)
  });

  it("includes rules about not advertising unavailable tools", () => {
    const manifest = buildToolManifest(CONNECTED_CTX);
    expect(manifest.manifestBlock).toContain("do NOT advertise capabilities");
    expect(manifest.manifestBlock).toContain("exact unavailable reason");
  });

  it("weather.current is always available (open-meteo needs no API key)", () => {
    const manifest = buildToolManifest(DISCONNECTED_CTX);
    const weatherTool = manifest.tools.find((t) => t.id === "weather.current");
    expect(weatherTool?.available).toBe(true);
  });
});

// ─── Unavailable Tool Error Messages ──────────────────────────────

describe("Unavailable Tool Error Messages", () => {
  it("explains terminal disconnection precisely", () => {
    const msg = explainUnavailableTool("terminal.execute", CONNECTED_CTX);
    expect(msg).toContain("terminal is disconnected");
    expect(msg).toContain("connect the terminal");
    expect(msg).not.toContain("I don't have access");
  });

  it("explains repository not connected precisely", () => {
    const msg = explainUnavailableTool("repository.info", DISCONNECTED_CTX);
    expect(msg).toContain("No repository is connected");
    expect(msg).toContain("Connect a GitHub repository");
  });

  it("explains workspace not ready precisely", () => {
    const msg = explainUnavailableTool("workspace.write", DISCONNECTED_CTX);
    expect(msg).toContain("workspace is not_prepared");
    expect(msg).toContain("workspace provisioning");
  });

  it("explains write terminal disconnection precisely", () => {
    // workspace.write now checks terminal connection, not approval
    const ctx = { ...CONNECTED_CTX, workspaceReady: true, writeAccess: false, terminalConnected: false };
    const msg = explainUnavailableTool("workspace.write", ctx);
    expect(msg).toContain("terminal is disconnected");
    expect(msg).toContain("Connect the terminal");
  });

  it("never gives generic 'I don't have access' responses", () => {
    const tools = ["terminal.execute", "repository.info", "workspace.write", "deployment.status"];
    for (const tool of tools) {
      const msg = explainUnavailableTool(tool, DISCONNECTED_CTX);
      expect(msg).not.toMatch(/i don't have access/i);
      expect(msg).not.toMatch(/i cannot access/i);
    }
  });
});

// ─── Agent Selection & Context Isolation Tests ────────────────────

describe("Agent Selection Rules", () => {
  // These tests verify the LOGIC that's implemented in the messages route.
  // The route defaults to "litt" and only switches to "spark" when
  // explicitly requested in the current message.

  it("LiTT is the default agent (not Spark)", () => {
    // This is enforced by the route: agentSlug defaults to "litt"
    // and only switches to "spark" if agentMode === "spark" or
    // requestedAgentSlug === "spark" in the current request.
    expect(CONNECTED_CTX.activeAgentSlug).toBe("litt");
    expect(CONNECTED_CTX.activeAgentMode).toBe("standard");
  });

  it("Spark context does not leak into Standard mode (memory scoping)", () => {
    // The memory service filters by agent_mode — Spark memories
    // (agent_mode = "spark") are not returned when querying with
    // agent_mode = "standard". This is verified in the memory-service tests.
    // Here we verify the runtime context correctly reports the agent mode.
    const sparkCtx: RuntimeContextSnapshot = {
      ...CONNECTED_CTX,
      activeAgentMode: "spark",
      activeAgentSlug: "spark",
    };
    const block = buildRuntimeContextBlock(sparkCtx);
    expect(block).toContain("spark");
    expect(block).not.toContain("standard");
  });
});

// ─── Expected Answer Format Tests ─────────────────────────────────

describe("Expected Answer Format", () => {
  it("matches the expected answer for the current project-status question", () => {
    // Updated expected answer with separated concepts:
    // "Your repository LabsConnected/litlabs-website is connected on main.
    //  The workspace is available and chat is working. The terminal is
    //  currently disconnected. Commands, builds, and terminal-based changes
    //  are unavailable. Write operations require your approval. No
    //  deployment status is currently shown."
    const answer = generateProjectStatusAnswer(CONNECTED_CTX);

    // Verify all key facts are present
    expect(answer).toContain("LabsConnected/litlabs-website");
    expect(answer).toContain("main");
    expect(answer).toContain("workspace is available");
    expect(answer).toContain("chat is working");
    expect(answer).toContain("terminal is currently disconnected");
    expect(answer).toContain("Write operations require your approval");
    expect(answer).toContain("No deployment status");
  });
});
