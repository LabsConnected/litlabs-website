import { describe, it, expect } from "vitest";
import {
  type StudioMessage,
  type LegacyBuilderSession,
  migrateMessage,
  migrateSession,
  createConversation,
  BUILTIN_AGENT_IDS,
} from "./conversation";

// ── Phase 2.1: Unified conversation domain ─────────────────────

describe("StudioMessage type", () => {
  it("requires id, role, content, status, createdAt", () => {
    const msg: StudioMessage = {
      id: "msg-1",
      role: "user",
      content: "Hello",
      status: "complete",
      createdAt: Date.now(),
    };
    expect(msg.id).toBe("msg-1");
    expect(msg.role).toBe("user");
    expect(msg.status).toBe("complete");
  });

  it("supports all message statuses", () => {
    const statuses: StudioMessage["status"][] = [
      "pending",
      "streaming",
      "complete",
      "failed",
      "cancelled",
    ];
    expect(statuses).toHaveLength(5);
  });

  it("supports all event types", () => {
    const events: StudioMessage["event"][] = [
      { type: "plan", steps: [] },
      { type: "activity", action: "test" },
      { type: "approval", request: { id: "1", title: "t", description: "d", actions: [] } },
      { type: "completion", summary: "done" },
      { type: "error", code: "E1", message: "fail", recoverable: true },
      { type: "artifact", artifactType: "code", name: "file.ts" },
      { type: "tool-result", tool: "shell", result: "ok" },
    ];
    expect(events).toHaveLength(7);
  });
});

describe("createConversation", () => {
  it("creates a conversation with a unique id", () => {
    const c1 = createConversation();
    const c2 = createConversation();
    expect(c1.id).not.toBe(c2.id);
    expect(c1.id).toBeTruthy();
  });

  it("defaults to LiTT agent", () => {
    const c = createConversation();
    expect(c.selectedAgentId).toBe("litt");
  });

  it("starts with empty messages", () => {
    const c = createConversation();
    expect(c.messages).toEqual([]);
  });

  it("has empty terminal sessions", () => {
    const c = createConversation();
    expect(c.terminalSessionIds).toEqual([]);
    expect(c.activeTerminalSessionId).toBeNull();
  });

  it("has a neutral project context", () => {
    const c = createConversation();
    expect(c.project.projectId).toBeNull();
    expect(c.project.repositoryState).toBe("none");
    expect(c.project.capabilities.read).toBe(false);
  });
});

// ── Phase 2.1: Migration from legacy format ────────────────────

describe("migrateMessage", () => {
  it("migrates a legacy builder message", () => {
    const legacy = { role: "user" as const, content: "Build it", createdAt: 1000 };
    const migrated = migrateMessage(legacy);
    expect(migrated.role).toBe("user");
    expect(migrated.content).toBe("Build it");
    expect(migrated.status).toBe("complete");
    expect(migrated.createdAt).toBe(1000);
    expect(migrated.id).toBeTruthy();
  });

  it("migrates a legacy chat message with images", () => {
    const legacy = { role: "user" as const, content: "See this", images: ["data:url"], createdAt: 2000 };
    const migrated = migrateMessage(legacy);
    expect(migrated.images).toEqual(["data:url"]);
    expect(migrated.createdAt).toBe(2000);
  });

  it("assigns agentId to assistant messages", () => {
    const legacy = { role: "assistant" as const, content: "Done" };
    const migrated = migrateMessage(legacy, "spark");
    expect(migrated.agentId).toBe("spark");
  });
});

describe("migrateSession", () => {
  it("migrates a legacy builder session to StudioConversation", () => {
    const legacy: LegacyBuilderSession = {
      id: "session-1",
      title: "My Project",
      pinned: true,
      messages: [
        { role: "user", content: "Build a landing page" },
        { role: "assistant", content: "On it" },
      ],
      context: {
        projectId: "proj-1",
        repositoryState: "connected",
        selectedAgent: "spark",
        terminalSessionIds: ["pty-1"],
        activeTerminalSessionId: "pty-1",
      },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    };
    const migrated = migrateSession(legacy);
    expect(migrated.id).toBe("session-1");
    expect(migrated.title).toBe("My Project");
    expect(migrated.pinned).toBe(true);
    expect(migrated.selectedAgentId).toBe("spark");
    expect(migrated.messages).toHaveLength(2);
    expect(migrated.messages[0].role).toBe("user");
    expect(migrated.messages[1].agentId).toBe("spark");
    expect(migrated.project.projectId).toBe("proj-1");
    expect(migrated.project.repositoryState).toBe("connected");
    expect(migrated.terminalSessionIds).toEqual(["pty-1"]);
  });
});

// ── Phase 2.3: Agent identity ──────────────────────────────────

describe("BUILTIN_AGENT_IDS", () => {
  it("includes litt and spark", () => {
    expect(BUILTIN_AGENT_IDS).toContain("litt");
    expect(BUILTIN_AGENT_IDS).toContain("spark");
  });
});
