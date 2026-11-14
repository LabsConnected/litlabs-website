/**
 * Shared predicate over a terminal-server /health payload: is sandbox
 * execution currently available?
 *
 * The terminal publishes host execution and sandbox execution as two
 * separate dimensions (Step 6):
 *
 *   terminal.execution — the HOST verdict ("enabled" | "disabled"). In
 *     production this stays "disabled": interactive PTY sessions and
 *     host processes remain fail-closed.
 *   terminal.sandbox — the sandbox dimension, enabled only while a
 *     fresh, green canary verifies the sandbox provider.
 *
 * Web consumers that gate the sandbox-wired surfaces (agent exec,
 * workspace prepare, preview) must accept the sandbox dimension instead
 * of reading the host verdict as "no execution at all". Consumers of
 * the interactive terminal itself must NOT use this predicate — there
 * is no sandbox session backend, so the host verdict still governs it.
 *
 * "Enabled" requires all three affirmations the terminal publishes —
 * execution "enabled", state "verified", and a freshUntil still in the
 * future — so a stale or hand-assembled payload cannot light this up.
 */
export interface TerminalSandboxHealthSection {
  execution?: unknown;
  state?: unknown;
  freshUntil?: unknown;
}

export interface TerminalHealthLike {
  terminal?: {
    execution?: unknown;
    sandbox?: TerminalSandboxHealthSection | null;
  } | null;
}

export function isSandboxExecutionEnabled(
  health: TerminalHealthLike | null | undefined,
  now: number = Date.now(),
): boolean {
  const sandbox = health?.terminal?.sandbox;
  if (!sandbox) return false;
  if (sandbox.execution !== "enabled") return false;
  if (sandbox.state !== "verified") return false;
  const freshUntil =
    typeof sandbox.freshUntil === "string" ? Date.parse(sandbox.freshUntil) : NaN;
  return Number.isFinite(freshUntil) && freshUntil > now;
}

/**
 * Combined execution condition: the terminal can run work when either
 * host execution is enabled (local development) OR sandbox execution
 * is enabled-and-fresh (production). The host verdict alone is never
 * widened — this is a read-time combination of two published facts.
 */
export function isTerminalExecutionCapable(
  health: TerminalHealthLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!health?.terminal) return false;
  if (health.terminal.execution !== "disabled") return true;
  return isSandboxExecutionEnabled(health, now);
}
