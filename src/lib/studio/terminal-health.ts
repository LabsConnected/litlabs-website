/**
 * Canonical terminal health — the ONE place Studio decides what the
 * terminal's state is and what to call it.
 *
 * Acceptance run 2026-09-28 showed three contradictory labels at once:
 * the header said "Terminal idle" (runtime phase), the Mission card said
 * "Terminal unavailable" (capability probe) and the operator bar said
 * "Terminal disconnected" (raw PTY store). Each surface now renders this
 * derivation instead of inventing its own wording.
 */
import type { TerminalStatus } from "@/lib/capabilities/types";

export type TerminalHealthState = "live" | "idle" | "connecting" | "down";
export type HealthLevel = "green" | "yellow" | "red";

export interface TerminalHealth {
  state: TerminalHealthState;
  level: HealthLevel;
  /** Short label — identical on every surface. */
  label: string;
  /** Tooltip / detail line. */
  detail: string;
}

export interface TerminalHealthInput {
  /** Client PTY store status. */
  storeStatus: TerminalStatus;
  /** Verified cwd from session:ready — only set when the PTY is truly ready. */
  cwd: string | null;
  /** Terminal server /health result. null = not checked yet. */
  serverReachable: boolean | null;
  error?: string | null;
}

/**
 * States that mean an actual terminal operation was attempted and failed
 * (socket/session errors during an attach). Only these may wear the red
 * "Terminal error" label.
 */
const ERROR_STATES: ReadonlySet<TerminalStatus> = new Set([
  "error",
  "auth_failed",
  "pty_failed",
]);

/**
 * States that mean the terminal is simply not available — NOT a failure:
 * "unavailable" is set for the TERMINAL_DISABLED deploy-time policy
 * verdict (TerminalPanel documents it as "a policy state, not a socket
 * failure") and for project-isolation verdicts; "project_context_missing"
 * means no project workspace resolved for the attach. An idle Studio
 * must read these calmly (wave-3, Larry's screenshot 2026-11-10: the
 * operator bar branded an untouched Studio "Terminal error").
 */
const UNAVAILABLE_STATES: ReadonlySet<TerminalStatus> = new Set([
  "unavailable",
  "project_context_missing",
]);

export function deriveTerminalHealth(input: TerminalHealthInput): TerminalHealth {
  const { storeStatus, cwd, serverReachable, error } = input;

  if (storeStatus === "connected" && cwd) {
    return { state: "live", level: "green", label: "Terminal live", detail: `Shell attached · ${cwd}` };
  }
  if (storeStatus === "connecting" || (storeStatus === "connected" && !cwd)) {
    return {
      state: "connecting",
      level: "yellow",
      label: "Terminal connecting…",
      detail: "Attaching to the workspace shell. LiTT can still run builds and checks.",
    };
  }
  if (ERROR_STATES.has(storeStatus)) {
    return {
      state: "down",
      level: "red",
      label: "Terminal error",
      detail: error || "The terminal session failed. It retries automatically.",
    };
  }
  if (UNAVAILABLE_STATES.has(storeStatus)) {
    return {
      state: "idle",
      level: "yellow",
      label: "Terminal unavailable",
      detail: error || (storeStatus === "project_context_missing"
        ? "The terminal needs a project workspace before it can connect."
        : "The terminal is not available in this environment."),
    };
  }
  // disconnected: the PTY is not attached — calm in both server cases.
  // serverReachable starts false until the first successful probe
  // (useConnectionSummary), so red/down here painted a false alarm on
  // every fresh load. Whether the server can execute is the runtime
  // phase's truth (terminal_unreachable), not this label's.
  if (serverReachable === true) {
    return {
      state: "idle",
      level: "yellow",
      label: "Terminal idle",
      detail: "Terminal server is up; no shell attached yet. LiTT runs builds and checks server-side.",
    };
  }
  if (serverReachable === false) {
    return {
      state: "idle",
      level: "yellow",
      label: "Terminal unavailable",
      detail: error || "No shell is attached and the terminal server has not answered. It connects when a session starts.",
    };
  }
  return {
    state: "connecting",
    level: "yellow",
    label: "Terminal checking…",
    detail: "Checking the terminal server.",
  };
}

export const HEALTH_LEVEL_COLOR: Record<HealthLevel, string> = {
  green: "var(--color-accent, #72f238)",
  yellow: "#e3b341",
  red: "#ef4444",
};

/**
 * Read the canonical health off a capabilities object, deriving it when an
 * older producer (fixture, companion) did not populate it — so no surface
 * ever falls back to its own wording.
 */
export function terminalHealthOf(caps: {
  terminalHealth?: TerminalHealth;
  terminalStatus: TerminalStatus;
  terminalCwd?: string | null;
  terminalServerReachable?: boolean;
  terminalError?: string | null;
}): TerminalHealth {
  return (
    caps.terminalHealth ??
    deriveTerminalHealth({
      storeStatus: caps.terminalStatus,
      cwd: caps.terminalCwd ?? null,
      serverReachable: caps.terminalServerReachable ?? null,
      error: caps.terminalError ?? null,
    })
  );
}
