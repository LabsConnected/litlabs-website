/**
 * executionTarget — the ONE canonical answer to "where does the model
 * call actually execute for this cockpit session".
 *
 * This is deliberately a SEPARATE axis from two other, easily-confused
 * pieces of state that must never be conflated with it:
 *
 *   - Transport state (RuntimeClient / cockpit-store `remoteRuntime`):
 *     offline | connecting | connected | reconnecting | error — whether
 *     the Socket.IO connection to terminal-server is currently up. This
 *     is connectivity, not a decision about where the model runs.
 *
 *   - Local tool-execution readiness (cockpit-store `localRuntime`):
 *     whether the CLI's own local RuntimeSession/ExecutionGateway is
 *     ready to run tools against the user's local project. This is
 *     ALWAYS "ready" once the cockpit boots, in BOTH executionTarget
 *     modes — REMOTE only moves the MODEL call server-side; tool calls
 *     always execute locally against the user's real project, because
 *     the server has no access to it.
 *
 * executionTarget answers a third, different question: which
 * ModelProvider does the agent loop actually call — the LOCAL adapter
 * (model-provider.ts, direct fetch to openrouter.ai using a local
 * OPENROUTER_API_KEY) or RemoteModelProvider (remote-model-provider.ts,
 * an authenticated server-side proxy that never exposes a key to this
 * process).
 *
 * "remote" is the ONLY mode a normal paid customer should ever be in —
 * the cockpit already requires a signed-in Clerk session to launch at
 * all (see index.ts's auth gate), so there is no reason to require a
 * local provider key on top of that. "local" is an explicit developer/
 * BYOK opt-in, gated behind LITT_LOCAL_MODE=1 — never inferred from the
 * mere presence of a provider env var. That inference (a local key
 * happening to be set → silently execute locally) was the exact
 * production gap this module closes: REMOTE could show connected in
 * the header while every model call still ran locally underneath it.
 */

export type ExecutionTarget = "local" | "remote";

/**
 * Resolve the execution target for this process. Called once at cockpit
 * startup — the result does not change over the life of the session (a
 * developer restarts the CLI to flip LITT_LOCAL_MODE, they don't toggle
 * it mid-session).
 */
export function resolveExecutionTarget(): ExecutionTarget {
  return process.env.LITT_LOCAL_MODE === "1" ? "local" : "remote";
}

/** Human label for the header/status bar. */
export function executionTargetLabel(target: ExecutionTarget): string {
  return target === "remote" ? "REMOTE" : "LOCAL";
}

/**
 * Which side actually executes the model provider for this target.
 * Purely derived from executionTarget — never an independently-set
 * piece of state, so it can never drift out of sync with it.
 */
export function providerExecutionLocation(target: ExecutionTarget): "client" | "server" {
  return target === "remote" ? "server" : "client";
}
