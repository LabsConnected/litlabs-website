/**
 * Terminal socket routing decision — the terminal bridge
 * (TERMINAL-BRIDGE-SPEC-2026-11-17 §2.2), extracted from server.ts's
 * isolation-gate middleware so the decision is unit-testable in the
 * same style as the rest of the terminal suite (server.ts itself
 * boots on import and is never imported by tests).
 *
 * The decision, in order:
 *   1. "host"    — the host isolation verdict enables terminal
 *                  execution (trusted local dev). The host path runs
 *                  exactly as it did before the bridge.
 *   2. "sandbox" — the host verdict refuses, BUT the socket carries
 *                  a verified workspace AND the sandbox gate (real
 *                  provider, routing enabled, owner allowlist, fresh
 *                  verified canary — SandboxWorkspaceExecutor's
 *                  isAvailableFor) is open for this user. The shell
 *                  runs inside the workspace's microVM, never on the
 *                  host.
 *   3. "refuse"  — everything else. The caller gets the pre-bridge
 *                  refusal ("Terminal unavailable: isolation not
 *                  verified"), word for word.
 *
 * Fail-closed by construction: the sandbox branch needs BOTH a
 * workspace on the (already authenticated, owner-gated) socket AND
 * a lazy gate check that returns true; any doubt lands on "refuse".
 * There is no route from a failed sandbox attach back to "host".
 */

export type TerminalSocketRoute = "host" | "sandbox" | "refuse";

export interface TerminalSocketRouteInput {
  /** The host isolation verdict's terminalExecution field. */
  terminalExecution: string;
  /** Authenticated user id from the socket's terminal JWT. */
  userId?: string;
  /** Workspace id verified by the auth middleware, if the token carried one. */
  workspaceId?: string;
  /**
   * Lazy sandbox-gate check (only consulted when the host verdict
   * refuses and a workspace is present — the gate reads a live
   * canary signal, so it is evaluated at decision time, never
   * cached).
   */
  sandboxAvailable: (userId: string) => boolean;
}

export function decideTerminalSocketRoute(
  input: TerminalSocketRouteInput,
): TerminalSocketRoute {
  if (input.terminalExecution === "enabled") return "host";
  if (input.userId && input.workspaceId && input.sandboxAvailable(input.userId)) {
    return "sandbox";
  }
  return "refuse";
}
