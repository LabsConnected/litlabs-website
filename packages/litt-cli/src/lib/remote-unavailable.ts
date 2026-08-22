/**
 * RemoteUnavailableError — the ONE explicit failure type for the
 * REMOTE execution path.
 *
 * Fail-closed contract:
 *   When REMOTE execution is selected and cannot be performed, the
 *   command TERMINATES with this error. It is never converted into
 *   permission to run the command locally.
 *
 * There is deliberately NO "fall back to local" branch anywhere in the
 * remote path. A REMOTE request that cannot reach the remote runtime is
 * a failure, not a request to execute somewhere else. Executing locally
 * after a remote failure would silently change WHERE the user's command
 * ran (different filesystem, different workspace, different authority)
 * while the operator believes it ran remotely — that is the exact class
 * of silent divergence this type exists to prevent.
 *
 * Reasons are enumerated so callers branch on `reason`, never on
 * message string-matching.
 */

/** Why the remote path could not execute. */
export type RemoteUnavailableReason =
  /** No credentials at all — user never signed in. */
  | "not_authenticated"
  /** Credentials exist but are expired and refresh failed. */
  | "auth_expired"
  /** Session is invalid/revoked server-side. */
  | "auth_revoked"
  /** terminal-server unreachable or unhealthy. */
  | "service_unavailable"
  /** Reached the service, but establishing the remote session failed. */
  | "session_failed"
  /** Remote session established, but the command could not be executed. */
  | "execution_failed";

/**
 * Short subject line per reason — used when the caller supplies no
 * specific detail. Keeps messages self-describing ("Not authenticated.")
 * instead of opening with bare remediation.
 */
const SUBJECT: Record<RemoteUnavailableReason, string> = {
  not_authenticated: "Not authenticated.",
  auth_expired: "Authentication expired.",
  auth_revoked: "Authentication is no longer valid.",
  service_unavailable: "Remote service unavailable.",
  session_failed: "Remote session could not be established.",
  execution_failed: "Remote execution failed.",
};

/** Operator-facing guidance per reason. Never suggests local execution. */
const REMEDY: Record<RemoteUnavailableReason, string> = {
  not_authenticated: "Run 'litt login' to sign in, then retry with --remote.",
  auth_expired: "Your session expired and could not be refreshed. Run 'litt login' to sign in again.",
  auth_revoked: "Your session is no longer valid. Run 'litt login' to sign in again.",
  service_unavailable: "The LiTT terminal service is unreachable. Check your connection or LITT_TERMINAL_URL.",
  session_failed: "Could not establish a remote session. Retry, or check the terminal service status.",
  execution_failed: "The remote runtime could not execute this command.",
};

/**
 * Thrown whenever REMOTE execution is selected but cannot be carried
 * out. Carries a typed `reason` so the CLI and cockpit can branch
 * without string matching.
 */
export class RemoteUnavailableError extends Error {
  readonly name = "RemoteUnavailableError";
  readonly reason: RemoteUnavailableReason;
  /** Structural marker — survives cross-realm/bundling identity loss. */
  readonly isRemoteUnavailable = true as const;

  constructor(reason: RemoteUnavailableReason, detail?: string) {
    super(`${detail ?? SUBJECT[reason]} ${REMEDY[reason]}`);
    this.reason = reason;
  }

  /** The remediation line on its own (no detail prefix). */
  get remedy(): string {
    return REMEDY[this.reason];
  }
}

/**
 * Type guard. Uses the structural marker rather than `instanceof` so it
 * stays correct across module-duplication boundaries.
 */
export function isRemoteUnavailable(error: unknown): error is RemoteUnavailableError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { isRemoteUnavailable?: unknown }).isRemoteUnavailable === true
  );
}

/** Reasons that mean "the stored credential is unusable and must be cleared". */
export const CREDENTIAL_CLEARING_REASONS: ReadonlySet<RemoteUnavailableReason> = new Set([
  "auth_expired",
  "auth_revoked",
]);
