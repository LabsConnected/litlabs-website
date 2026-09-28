import { describe, it, expect } from "vitest";
import { deriveTerminalHealth } from "./terminal-health";

describe("deriveTerminalHealth — one canonical terminal state", () => {
  it("live only when the PTY is connected with a verified cwd", () => {
    expect(deriveTerminalHealth({ storeStatus: "connected", cwd: "/ws", serverReachable: true }))
      .toMatchObject({ state: "live", level: "green", label: "Terminal live" });
    expect(deriveTerminalHealth({ storeStatus: "connected", cwd: null, serverReachable: true }))
      .toMatchObject({ state: "connecting", level: "yellow" });
  });

  it("a healthy server with no attached PTY is idle, never unavailable", () => {
    // Regression: the probe used to omit serverReachable, so this case
    // rendered "Terminal unavailable" next to a header saying "idle".
    expect(deriveTerminalHealth({ storeStatus: "disconnected", cwd: null, serverReachable: true }))
      .toMatchObject({ state: "idle", label: "Terminal idle" });
  });

  it("an unreachable server is down/red", () => {
    expect(deriveTerminalHealth({ storeStatus: "disconnected", cwd: null, serverReachable: false }))
      .toMatchObject({ state: "down", level: "red", label: "Terminal unavailable" });
  });

  it("error states are red and carry the real error", () => {
    const h = deriveTerminalHealth({ storeStatus: "auth_failed", cwd: null, serverReachable: true, error: "Unauthorized" });
    expect(h).toMatchObject({ state: "down", level: "red", label: "Terminal error", detail: "Unauthorized" });
  });

  it("unknown server state reads as checking, not as an outage", () => {
    expect(deriveTerminalHealth({ storeStatus: "disconnected", cwd: null, serverReachable: null }))
      .toMatchObject({ state: "connecting", level: "yellow" });
  });

  it("every store status maps to exactly one label", () => {
    const statuses = ["disconnected", "connecting", "connected", "error", "unavailable", "project_context_missing", "pty_failed", "auth_failed"] as const;
    for (const s of statuses) {
      const h = deriveTerminalHealth({ storeStatus: s, cwd: s === "connected" ? "/ws" : null, serverReachable: true });
      expect(typeof h.label).toBe("string");
      expect(["green", "yellow", "red"]).toContain(h.level);
    }
  });
});
