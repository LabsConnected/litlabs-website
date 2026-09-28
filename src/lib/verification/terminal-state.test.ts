/**
 * PASS 2 terminal acceptance tests — the disconnected/idle semantic fix.
 *
 * Proves:
 * - connected + fresh + inactive        => idle is valid
 * - connected + busy + fresh             => busy
 * - stale heartbeat                      => must NOT assert confirmed idle
 * - disconnected visible PTY            => must NOT automatically equal execution outage
 * - server execution independently proven available while visible PTY
 *   disconnected                         => execution may remain available, but
 *                                          PTY/session status stays truthful
 * - no component-local optimistic fallback may override canonical facts
 *   (the model is derived in exactly one place)
 */
import { describe, expect, it } from "vitest";
import {
  deriveTerminalModel,
  terminalModelLabel,
} from "./terminal-state";
import {
  runtimePhaseLabel,
  terminalModelFromRuntime,
} from "../projects/runtime-state";

describe("terminal freshness model (INV-004)", () => {
  it("connected + fresh + inactive => idle is valid", () => {
    const model = deriveTerminalModel({
      connection: "connected",
      freshness: "fresh",
      hasActiveCommand: false,
      serverExecutionProven: true,
    });
    expect(model.activity).toBe("idle");
    expect(model.idleClaimValid).toBe(true);
    expect(terminalModelLabel(model)).toBe("Terminal idle");
  });

  it("connected + busy + fresh => busy", () => {
    const model = deriveTerminalModel({
      connection: "connected",
      freshness: "fresh",
      hasActiveCommand: true,
      serverExecutionProven: true,
    });
    expect(model.activity).toBe("busy");
    expect(model.idleClaimValid).toBe(false);
    expect(terminalModelLabel(model)).toBe("Terminal busy");
  });

  it("stale heartbeat => must NOT assert confirmed idle", () => {
    const model = deriveTerminalModel({
      connection: "connected",
      freshness: "stale",
      hasActiveCommand: false,
      serverExecutionProven: true,
    });
    expect(model.activity).toBe("unknown");
    expect(model.idleClaimValid).toBe(false);
    expect(terminalModelLabel(model)).not.toContain("idle");
  });

  it("unreachable feed => must NOT assert confirmed idle", () => {
    const model = deriveTerminalModel({
      connection: "connected",
      freshness: "unreachable",
      hasActiveCommand: false,
      serverExecutionProven: true,
    });
    expect(model.activity).toBe("unknown");
    expect(model.idleClaimValid).toBe(false);
  });

  it("disconnected visible PTY => must NOT automatically equal execution outage", () => {
    // Server-side execution independently proven available...
    const model = deriveTerminalModel({
      connection: "disconnected",
      freshness: "unreachable",
      hasActiveCommand: false,
      serverExecutionProven: true,
    });
    // ...so execution stays available...
    expect(model.executionAvailable).toBe(true);
    // ...but the PTY/session status stays truthful: not idle, not connected.
    expect(model.activity).toBe("unknown");
    expect(model.connection).toBe("disconnected");
    expect(model.idleClaimValid).toBe(false);
    expect(terminalModelLabel(model)).toBe(
      "Terminal not attached — execution available",
    );
  });

  it("disconnected PTY with no server proof => execution NOT claimed available", () => {
    const model = deriveTerminalModel({
      connection: "disconnected",
      freshness: "unreachable",
      hasActiveCommand: false,
      serverExecutionProven: false,
    });
    expect(model.executionAvailable).toBe(false);
    expect(model.activity).toBe("unknown");
    // Truthful, not alarmist: states the PTY fact without inventing an outage.
    expect(terminalModelLabel(model)).toBe("Terminal not attached");
  });

  it("reconnecting => never idle, never a confirmed outage", () => {
    const model = deriveTerminalModel({
      connection: "reconnecting",
      freshness: "stale",
      hasActiveCommand: false,
      serverExecutionProven: false,
    });
    expect(model.activity).toBe("unknown");
    expect(model.idleClaimValid).toBe(false);
    expect(terminalModelLabel(model)).toBe("Reconnecting terminal…");
  });

  it("busy channel that loses freshness => unknown, never stale-idle", () => {
    const model = deriveTerminalModel({
      connection: "connected",
      freshness: "stale",
      hasActiveCommand: true,
      serverExecutionProven: true,
    });
    expect(model.activity).toBe("unknown");
    expect(model.idleClaimValid).toBe(false);
  });
});

describe("runtime-state integration (no local re-derivation)", () => {
  it("terminal_disconnected phase never renders as 'Terminal idle'", () => {
    expect(runtimePhaseLabel("terminal_disconnected")).not.toContain("idle");
    expect(runtimePhaseLabel("terminal_disconnected")).toBe("Terminal not attached");
  });

  it("terminalModelFromRuntime is the single derivation call site", () => {
    // Disconnected PTY + unreachable feed, server proven available.
    const model = terminalModelFromRuntime({
      phase: "terminal_disconnected",
      terminalConnected: false,
      terminalServerReachable: true,
      freshness: "unreachable",
      hasActiveCommand: false,
    });
    expect(model.connection).toBe("disconnected");
    expect(model.activity).toBe("unknown");
    expect(model.idleClaimValid).toBe(false);
    expect(model.executionAvailable).toBe(true);

    // Connected + fresh + verified session => idle is truthful.
    const live = terminalModelFromRuntime({
      phase: "ready",
      terminalConnected: true,
      terminalServerReachable: true,
      freshness: "fresh",
      hasActiveCommand: false,
    });
    expect(live.activity).toBe("idle");
    expect(live.idleClaimValid).toBe(true);
  });

  it("stale feed on a 'ready' phase degrades activity to unknown, not idle", () => {
    const model = terminalModelFromRuntime({
      phase: "ready",
      terminalConnected: true,
      terminalServerReachable: true,
      freshness: "stale",
      hasActiveCommand: false,
    });
    expect(model.activity).toBe("unknown");
    expect(model.idleClaimValid).toBe(false);
  });
});
