/**
 * executionTarget — the canonical answer to "where does the model call
 * execute for this cockpit session" AND "is the cockpit locked to
 * local-only (emergency/offline mode)".
 *
 * Two SEPARATE concepts that must never be conflated:
 *
 *   1. executionTarget: "local" | "remote"
 *      - Where the model provider runs for this session.
 *      - Switchable at runtime via /local and /remote commands.
 *      - DEFAULT is "local" — LiTT starts LOCAL by default.
 *
 *   2. localOnly: boolean
 *      - Whether the cockpit is locked to local-only (emergency/offline).
 *      - When true, model/remote/cloud paths are hard-blocked.
 *      - Set by LITT_LOCAL_ONLY=1 (NOT LITT_LOCAL_MODE).
 *      - When false, the user can freely switch between local and remote.
 *
 * The distinction is critical:
 *   executionTarget=local + localOnly=false
 *     → LOCAL is active, but /remote can switch if authenticated
 *   executionTarget=local + localOnly=true
 *     → LOCAL is active AND remote is permanently blocked
 *   executionTarget=remote
 *     → REMOTE is active (implies localOnly=false)
 *
 * Resolution priority for the initial execution target:
 *   explicit CLI flag (--local / --remote)
 *   > LITT_LOCAL_ONLY=1 (forces local + localOnly)
 *   > LITT_LOCAL_MODE=1 (legacy: forces local + localOnly)
 *   > default LOCAL
 */

export type ExecutionTarget = "local" | "remote";

/**
 * Full runtime mode — the two independent axes.
 */
export interface RuntimeMode {
  executionTarget: ExecutionTarget;
  localOnly: boolean;
}

/**
 * Resolve the initial runtime mode from env vars and CLI flags.
 *
 * Called once at cockpit startup. The executionTarget can be switched
 * later via /local and /remote commands; localOnly is fixed for the
 * session (changing it requires a restart with different env).
 *
 * Parameters:
 *   flagTarget — "local" | "remote" | undefined (from --local/--remote)
 *
 * Resolution:
 *   1. LITT_LOCAL_ONLY=1 → local + localOnly=true (emergency mode)
 *   2. LITT_LOCAL_MODE=1 → local + localOnly=true (legacy compat)
 *   3. --remote flag → remote + localOnly=false (if not locked)
 *   4. --local flag → local + localOnly=false
 *   5. default → local + localOnly=false
 */
export function resolveRuntimeMode(flagTarget?: ExecutionTarget): RuntimeMode {
  // Emergency/offline mode: hard lock to local, block all remote
  if (process.env.LITT_LOCAL_ONLY === "1") {
    return { executionTarget: "local", localOnly: true };
  }
  // Legacy compat: LITT_LOCAL_MODE=1 behaves as local-only lock
  if (process.env.LITT_LOCAL_MODE === "1") {
    return { executionTarget: "local", localOnly: true };
  }
  // Explicit CLI flag (passed from index.ts via LITT_TARGET_OVERRIDE
  // or directly as flagTarget)
  const effectiveTarget = flagTarget ?? (
    process.env.LITT_TARGET_OVERRIDE === "remote" ? "remote" :
    process.env.LITT_TARGET_OVERRIDE === "local" ? "local" : undefined
  );
  if (effectiveTarget === "remote") {
    return { executionTarget: "remote", localOnly: false };
  }
  if (effectiveTarget === "local") {
    return { executionTarget: "local", localOnly: false };
  }
  // Default: LOCAL, remote available
  return { executionTarget: "local", localOnly: false };
}

/**
 * Resolve the initial execution target (backward compat).
 * Uses resolveRuntimeMode and returns just the target.
 */
export function resolveExecutionTarget(flagTarget?: ExecutionTarget): ExecutionTarget {
  return resolveRuntimeMode(flagTarget).executionTarget;
}

/**
 * Resolve whether local-only mode is active.
 */
export function resolveLocalOnly(): boolean {
  return resolveRuntimeMode().localOnly;
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
