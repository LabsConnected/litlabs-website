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

  it("a disconnected PTY with an unconfirmed server is calm, not red", () => {
    // Wave-3 (Larry's screenshot, 2026-11-10): a fresh, idle Studio painted
    // red terminal states before anything had failed. serverReachable is
    // false until the first successful probe (useConnectionSummary), so
    // red/down here fired by default on every load. The PTY simply is not
    // attached — server-down truth for execution lives in the runtime
    // phase, not in this label. Label stays honest, level/state calm.
    expect(deriveTerminalHealth({ storeStatus: "disconnected", cwd: null, serverReachable: false }))
      .toMatchObject({ state: "idle", level: "yellow", label: "Terminal unavailable" });
  });

  it("policy/context states are unavailable, never 'Terminal error'", () => {
    // "unavailable" is set for the TERMINAL_DISABLED deploy-time verdict
    // (TerminalPanel: "a policy state, not a socket failure") and for
    // isolation verdicts; "project_context_missing" means no project
    // workspace resolved. Neither is a failed terminal operation, so
    // neither may wear the red error label in an idle Studio.
    expect(deriveTerminalHealth({ storeStatus: "unavailable", cwd: null, serverReachable: true, error: "Terminal is disabled" }))
      .toMatchObject({ state: "idle", level: "yellow", label: "Terminal unavailable", detail: "Terminal is disabled" });
    expect(deriveTerminalHealth({ storeStatus: "project_context_missing", cwd: null, serverReachable: true }))
      .toMatchObject({ state: "idle", level: "yellow", label: "Terminal unavailable" });
  });

  it("pty_failed is a real failed operation and stays red", () => {
    expect(deriveTerminalHealth({ storeStatus: "pty_failed", cwd: null, serverReachable: true, error: "spawn failed" }))
      .toMatchObject({ state: "down", level: "red", label: "Terminal error", detail: "spawn failed" });
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
