import { describe, expect, it } from "vitest";
import {
  deriveExecutionHint,
  runtimeFreshnessLabel,
  runtimePhaseLabel,
} from "./runtime-state";

describe("runtimePhaseLabel", () => {
  it("labels terminal_disconnected truthfully — never 'Terminal idle' without a live session", () => {
    // INV-004: "idle" is an activity claim valid only with a live verified
    // session + fresh heartbeat. A detached PTY must not claim idle.
    // Execution availability is reported separately via the terminal model.
    expect(runtimePhaseLabel("terminal_disconnected")).toBe("Terminal not attached");
  });

  it("keeps the other phase labels intact", () => {
    expect(runtimePhaseLabel("idle")).toBe("No project selected");
    expect(runtimePhaseLabel("ready")).toBe("Workspace ready");
    expect(runtimePhaseLabel("workspace_not_provisioned")).toBe(
      "Workspace not provisioned",
    );
    expect(runtimePhaseLabel("error")).toBe("Runtime error");
    expect(runtimePhaseLabel("unauthenticated")).toBe("Sign in required");
  });
});

describe("runtimeFreshnessLabel", () => {
  it("maps fresh to Live", () => {
    expect(runtimeFreshnessLabel("fresh")).toBe("Live");
  });

  it("explains that stale means the status may be behind", () => {
    expect(runtimeFreshnessLabel("stale")).toBe(
      "State feed stale — status may be behind",
    );
  });

  it("says the socket is a status feed and that chat/builds still work", () => {
    expect(runtimeFreshnessLabel("unreachable")).toBe(
      "State feed unreachable — chat works; builds run through the server",
    );
  });
});

describe("deriveExecutionHint", () => {
  it("warns pre-send when the status feed is unreachable but the workspace is ready", () => {
    expect(
      deriveExecutionHint("unreachable", {
        phase: "terminal_disconnected",
        workspaceProvisioned: true,
      }),
    ).toBe(
      "Live status feed is down — LiTT can still chat and run builds through the server.",
    );
  });

  it("also fires when phase is ready", () => {
    expect(
      deriveExecutionHint("unreachable", {
        phase: "ready",
        workspaceProvisioned: true,
      }),
    ).not.toBeNull();
  });

  it("stays silent when unreachable but the workspace is not provisioned", () => {
    // No workspace → the header already shows the real blocker; the hint
    // would only add noise.
    expect(
      deriveExecutionHint("unreachable", {
        phase: "workspace_not_ready",
        workspaceProvisioned: false,
      }),
    ).toBeNull();
  });

  it("stays silent when the feed is fresh or merely stale", () => {
    const ready = { phase: "ready" as const, workspaceProvisioned: true };
    expect(deriveExecutionHint("fresh", ready)).toBeNull();
    expect(deriveExecutionHint("stale", ready)).toBeNull();
  });
});
