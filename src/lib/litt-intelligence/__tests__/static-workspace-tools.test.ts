import { describe, it, expect } from "vitest";
import { resolveTerminalHealth, resolveToolHealth } from "../tool-health";

/**
 * Gate B regression: static (gitless) workspaces must not advertise
 * host execution capability. The agent should select files.write,
 * not terminal.execute, for static workspaces.
 */
describe("static workspace tool routing", () => {
  it("hides shell-backed discovery, search, Git and check delegates", () => {
    const ids = ["project.scan", "package.info", "search_code", "code.search", "git.status", "checks.build", "typecheck.run", "files.list", "files.read", "files.write"];
    const health = resolveToolHealth(ids, { terminal: { userId: "owner", isStaticWorkspace: true } });
    for (const id of ids.slice(0, 7)) expect(health.get(id)?.health).toBe("unavailable");
    for (const id of ids.slice(7)) expect(health.get(id)?.health).not.toBe("unavailable");
  });
  it("reports terminal.execute as unavailable for static workspaces", () => {
    const report = resolveTerminalHealth({
      userId: "user_123",
      isTerminalOwner: true,
      terminalServerReachable: true,
      isStaticWorkspace: true,
    });

    expect(report.toolId).toBe("terminal.execute");
    expect(report.health).toBe("unavailable");
    expect(report.reason).toBe("static_workspace_no_exec");
    expect(report.detail).toContain("files.write");
  });

  it("still reports available for non-static workspaces (owner)", () => {
    const report = resolveTerminalHealth({
      userId: "user_123",
      isTerminalOwner: true,
      terminalServerReachable: true,
      isStaticWorkspace: false,
    });

    // Should not be blocked by static check
    expect(report.reason).not.toBe("static_workspace_no_exec");
  });

  it("static check takes precedence over ownership", () => {
    // Even an owner cannot exec on a static workspace
    const report = resolveTerminalHealth({
      userId: "user_123",
      isTerminalOwner: true,
      terminalServerReachable: true,
      isStaticWorkspace: true,
    });

    expect(report.health).toBe("unavailable");
  });
});
