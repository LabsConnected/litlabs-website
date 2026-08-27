/**
 * Command execution routing — decides REMOTE vs LOCAL, once.
 *
 * Fail-closed contract:
 *   When `useRemote` is true, the local executor is NEVER invoked.
 *   Not on auth failure, not on transport failure, not on remote
 *   execution failure, not on an unsupported command. Every one of
 *   those paths terminates with an explicit remote error.
 *
 * The executors are injected rather than imported so the "local runner
 * was not invoked" guarantee is directly observable in tests: a spy is
 * passed as `localExecutor` and asserted untouched. A guarantee you
 * cannot observe is a guarantee you cannot trust.
 */

import { RemoteUnavailableError, isRemoteUnavailable, CREDENTIAL_CLEARING_REASONS } from "./remote-unavailable.js";

export interface ExecuteCommandDeps {
  /** True when --remote was passed. */
  useRemote: boolean;
  /** Runs the command on the remote runtime. Resolves to an exit code. */
  remoteExecutor: () => Promise<number>;
  /** Runs the command locally. NEVER called when useRemote is true. */
  localExecutor: () => Promise<number>;
  /** Whether a command is supported over the remote transport. */
  isRemoteable: (command: string) => boolean;
  /** Sink for operator-facing error output (defaults to console.error). */
  onError?: (message: string) => void;
}

export interface ExecutionOutcome {
  /** The path actually taken. "none" means nothing executed anywhere. */
  path: "remote" | "local" | "none";
  exitCode: number;
  /** Present when the remote path failed. */
  reason?: string;
}

/**
 * Route one command to exactly one execution path.
 *
 * Returns `path: "none"` when REMOTE was requested but could not run —
 * this is the fail-closed outcome. It is deliberately distinct from
 * `"local"` so callers and tests can tell "did not execute" apart from
 * "executed somewhere else".
 */
export async function executeCommand(
  command: string,
  deps: ExecuteCommandDeps,
): Promise<ExecutionOutcome> {
  const emit = deps.onError ?? ((m: string) => console.error(m));

  if (!deps.useRemote) {
    return { path: "local", exitCode: await deps.localExecutor() };
  }

  // ─── REMOTE selected — from here the local executor is unreachable ──

  if (!deps.isRemoteable(command)) {
    emit(`--remote is not supported for '${command}'.`);
    return { path: "none", exitCode: 1, reason: "unsupported_command" };
  }

  try {
    return { path: "remote", exitCode: await deps.remoteExecutor() };
  } catch (error) {
    // Every failure mode lands here and terminates. There is no branch
    // from this catch to deps.localExecutor() — by construction.
    if (isRemoteUnavailable(error)) {
      emit(`Remote execution unavailable: ${error.message}`);
      // If the reason means the stored credential is unusable
      // (auth_expired / auth_revoked), proactively clear it so the
      // user can simply run `litt login` next instead of getting
      // stuck with dead credentials on disk. This does NOT fall back
      // to local execution — the fail-closed contract is preserved.
      if (CREDENTIAL_CLEARING_REASONS.has(error.reason)) {
        try {
          const { getAuthSession } = await import("./auth/auth-session.js");
          await getAuthSession().logout();
        } catch {
          // Best-effort — the error message already tells the user
          // to run `litt login`, which will overwrite the dead creds.
        }
      }
      return { path: "none", exitCode: 1, reason: error.reason };
    }
    const message = error instanceof Error ? error.message : String(error);
    emit(`Remote execution failed: ${message}`);
    return { path: "none", exitCode: 1, reason: "execution_failed" };
  }
}

/**
 * Assert a remote precondition, throwing the typed fail-closed error.
 * Small helper so call sites read as guards rather than if/throw noise.
 */
export function requireRemote(
  condition: unknown,
  reason: ConstructorParameters<typeof RemoteUnavailableError>[0],
  detail?: string,
): asserts condition {
  if (!condition) throw new RemoteUnavailableError(reason, detail);
}
