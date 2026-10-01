/**
 * Tests for LiTT Tool Health (Part F).
 *
 * Spec mapping:
 * - Test 5: terminal healthy → available
 * - Test 6: terminal unhealthy (non-owner → Forbidden by design) →
 *   unavailable, never advertised; degraded → no retry loops
 * - Test 9: (covered in agent-loop tests) disabled handlerless tools
 *   are never sent to the model
 */
import { describe, it, expect } from "vitest";
import {
  resolveTerminalHealth,
  resolveToolHealth,
  filterOfferableTools,
  buildToolHealthPromptNote,
} from "./tool-health";

describe("resolveTerminalHealth", () => {
  it("Test 5: terminal healthy for owner → available", () => {
    const report = resolveTerminalHealth({
      userId: "user_owner123",
      isTerminalOwner: true,
      terminalServerReachable: true,
    });
    expect(report.toolId).toBe("terminal.execute");
    expect(report.health).toBe("available");
  });

  it("Test 6: terminal unavailable for non-owner (Forbidden by design)", () => {
    const report = resolveTerminalHealth({
      userId: "user_testaccount",
      isTerminalOwner: false,
    });
    expect(report.health).toBe("unavailable");
    expect(report.reason).toBe("not_terminal_owner");
  });

  it("terminal unavailable without authenticated user", () => {
    const report = resolveTerminalHealth({ userId: null });
    expect(report.health).toBe("unavailable");
    expect(report.reason).toBe("no_authenticated_user");
  });

  it("terminal degraded when server unreachable", () => {
    const report = resolveTerminalHealth({
      userId: "user_owner123",
      isTerminalOwner: true,
      terminalServerReachable: false,
    });
    expect(report.health).toBe("degraded");
    expect(report.reason).toBe("terminal_server_unreachable");
  });

  it("terminal degraded (not unavailable) when ownership unknown", () => {
    const report = resolveTerminalHealth({ userId: "user_x" });
    expect(report.health).toBe("degraded");
  });
});

describe("resolveToolHealth", () => {
  it("approval-gated tools are advertised as approval_required", () => {
    const health = resolveToolHealth(["project.deploy", "files.write"]);
    expect(health.get("project.deploy")?.health).toBe("approval_required");
    expect(health.get("files.write")?.health).toBe("available");
  });

  it("overrides take precedence", () => {
    const health = resolveToolHealth(["web.search"], {
      overrides: {
        "web.search": {
          toolId: "web.search",
          health: "degraded",
          reason: "test",
        },
      },
    });
    expect(health.get("web.search")?.health).toBe("degraded");
  });
});

describe("filterOfferableTools", () => {
  it("Test 6: unavailable tools are dropped, never advertised", () => {
    const health = resolveToolHealth(["terminal.execute", "files.write"], {
      terminal: { userId: "u", isTerminalOwner: false },
    });
    const { offerable, dropped } = filterOfferableTools(health);
    expect(dropped).toContain("terminal.execute");
    expect(offerable).not.toContain("terminal.execute");
    expect(offerable).toContain("files.write");
  });

  it("degraded tools are offered but flagged", () => {
    const health = resolveToolHealth(["terminal.execute"], {
      terminal: { userId: "u", isTerminalOwner: true, terminalServerReachable: false },
    });
    const { offerable, degraded } = filterOfferableTools(health);
    expect(offerable).toContain("terminal.execute");
    expect(degraded).toContain("terminal.execute");
  });
});

describe("buildToolHealthPromptNote", () => {
  it("warns about unavailable and degraded tools", () => {
    const health = resolveToolHealth(["terminal.execute", "web.search"], {
      terminal: { userId: "u", isTerminalOwner: false },
      overrides: {
        "web.search": { toolId: "web.search", health: "degraded", reason: "slow" },
      },
    });
    const note = buildToolHealthPromptNote(health);
    expect(note).toContain("UNAVAILABLE TOOLS");
    expect(note).toContain("terminal.execute");
    expect(note).toContain("DEGRADED TOOLS");
    expect(note).toContain("never retry in a loop");
  });

  it("returns null when everything is available", () => {
    const health = resolveToolHealth(["files.write"]);
    expect(buildToolHealthPromptNote(health)).toBeNull();
  });
});
