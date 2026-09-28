/**
 * LiTT Verification Foundation — canonical terminal state model (pure).
 *
 * The old behavior rendered `terminal_disconnected` as "Terminal idle". That
 * label was deliberately non-alarmist (a detached visible PTY does not mean
 * server-side execution is down), but "idle" is an ACTIVITY claim and is
 * only truthful with a live verified session + fresh heartbeat (INV-004).
 *
 * This module models the four concepts independently:
 * - terminal/session connectivity: connected | disconnected | reconnecting
 * - heartbeat freshness: fresh | stale | unreachable
 * - execution availability: boolean (from INDEPENDENT server-side proof)
 * - terminal activity: idle | busy | unknown
 *
 * Rules:
 * - idle is valid ONLY when connection=connected AND freshness=fresh AND no
 *   active command. Stale/unreachable/disconnected => activity is unknown,
 *   never idle (INV-004).
 * - A stale or disconnected PTY must NOT automatically claim a server-side
 *   execution outage: executionAvailable comes only from independent
 *   server-side proof (the old deliberate non-alarmist behavior, preserved).
 * - UI components must consume this derivation, never re-derive it locally.
 */
export type TerminalConnection = "connected" | "disconnected" | "reconnecting";
export type TerminalFreshness = "fresh" | "stale" | "unreachable";
export type TerminalActivity = "idle" | "busy" | "unknown";

export interface TerminalModelInput {
  connection: TerminalConnection;
  freshness: TerminalFreshness;
  /** Whether a command is currently executing on the channel. */
  hasActiveCommand: boolean;
  /**
   * Independent server-side proof that execution works (e.g. terminal-server
   * health check, recent successful server-side exec). NEVER derived from
   * the visible PTY connection state.
   */
  serverExecutionProven: boolean;
}

export interface TerminalModel {
  connection: TerminalConnection;
  freshness: TerminalFreshness;
  activity: TerminalActivity;
  executionAvailable: boolean;
  /** True only when claiming "idle" is truthful (INV-004). */
  idleClaimValid: boolean;
}

/**
 * Derive the canonical terminal model. Pure and deterministic.
 */
export function deriveTerminalModel(input: TerminalModelInput): TerminalModel {
  const { connection, freshness, hasActiveCommand, serverExecutionProven } = input;

  let activity: TerminalActivity;
  if (connection !== "connected" || freshness !== "fresh") {
    // No live verified channel => activity is unknown. Never idle, never busy.
    activity = "unknown";
  } else if (hasActiveCommand) {
    activity = "busy";
  } else {
    activity = "idle";
  }

  return {
    connection,
    freshness,
    activity,
    // Independent of the visible PTY: a disconnected feed must not claim an
    // execution outage when server-side execution is proven available —
    // and must not claim availability when it is not proven either.
    executionAvailable: serverExecutionProven,
    idleClaimValid: activity === "idle",
  };
}

/**
 * Truthful one-line label for the terminal model. Never claims idle without
 * a live session; never claims an outage without proof.
 */
export function terminalModelLabel(model: TerminalModel): string {
  if (model.activity === "busy") return "Terminal busy";
  if (model.activity === "idle") return "Terminal idle";
  // activity === "unknown": describe the connection truthfully.
  switch (model.connection) {
    case "disconnected":
      return model.executionAvailable
        ? "Terminal not attached — execution available"
        : "Terminal not attached";
    case "reconnecting":
      return "Reconnecting terminal…";
    case "connected":
      return model.freshness === "stale"
        ? "Terminal state stale"
        : "Terminal state unknown";
  }
}
