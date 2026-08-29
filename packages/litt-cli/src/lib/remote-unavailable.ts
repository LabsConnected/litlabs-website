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
  /**
   * Reached the service and authenticated, but it does not serve this
   * endpoint (HTTP 404). Either the CLI is calling a stale path or the
   * service is running a build that predates the route. This is NOT a
   * session failure — reporting it as one sends the operator to retry
   * and check service status for a problem neither can fix.
   */
  | "endpoint_missing"
  /** Authenticated, but the service refused the request (HTTP 403). */
  | "forbidden"
  /** The service reached an internal error (HTTP 5xx). */
  | "server_error"
  /** Remote session established, but the command could not be executed. */
  | "execution_failed"
  /** No remote project workspace is prepared for this account. */
  | "workspace_required"
  /** Multiple ready workspaces exist; the caller must select one. */
  | "workspace_selection_required"
  /** Authenticated, but not authorized for the requested workspace. */
  | "workspace_unauthorized"
  /** The server's billing/entitlement service could not be reached. */
  | "billing_unavailable"
  /** Authenticated, but the account's plan does not include CLI access. */
  | "plan_not_entitled"
  /** Authenticated and entitled, but the LiTTBits balance is exhausted. */
  | "insufficient_credits";

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
  endpoint_missing: "The terminal service does not provide this endpoint.",
  forbidden: "The terminal service refused this request.",
  server_error: "The terminal service reported an internal error.",
  execution_failed: "Remote execution failed.",
  workspace_required: "No remote project workspace is prepared.",
  workspace_selection_required: "Multiple remote workspaces are available.",
  workspace_unauthorized: "Not authorized for that workspace.",
  billing_unavailable: "Billing service unavailable.",
  plan_not_entitled: "Your plan does not include LiTT CLI access.",
  insufficient_credits: "LiTTBits balance exhausted.",
};

/** Operator-facing guidance per reason. Never suggests local execution. */
const REMEDY: Record<RemoteUnavailableReason, string> = {
  not_authenticated: "Run 'litt login' to sign in, then retry with --remote.",
  auth_expired: "Your session expired and could not be refreshed. Run 'litt login' to sign in again.",
  auth_revoked: "Your session is no longer valid. Run 'litt login' to sign in again.",
  service_unavailable: "The LiTT terminal service is unreachable. Check your connection or LITT_TERMINAL_URL.",
  session_failed: "Could not establish a remote session. Retry, or check the terminal service status.",
  // NOT "retry" — a missing route does not appear on the next attempt.
  // The CLI and the service disagree about the API surface; one of the
  // two is out of date.
  endpoint_missing: "The CLI and the terminal service disagree on the API. Update the CLI ('npm i -g @litt/cli'), or check that the terminal service is running a current build.",
  forbidden: "Your session is valid but this request was refused. Check that your account has access to this resource.",
  server_error: "This is a server-side fault, not a problem with your session. Retry shortly, or check the terminal service status.",
  execution_failed: "The remote runtime could not execute this command.",
  workspace_required: "Prepare a remote project workspace, then retry with --remote.",
  workspace_selection_required: "Specify which workspace to use with --workspace <id>.",
  workspace_unauthorized: "You are authenticated but not authorized for that workspace. Select a workspace that belongs to your account.",
  // NOTE: none of the three below suggest 'litt login'. They are NOT
  // authentication failures — the session is valid. Telling the user to
  // re-authenticate here sends them down a dead end for a problem that
  // re-authenticating cannot fix.
  billing_unavailable: "This is a server-side problem, not a problem with your session — your login is still valid. Retry shortly, or check the terminal service status.",
  plan_not_entitled: "Upgrade your plan at litlabs.net to use the CLI remotely.",
  insufficient_credits: "Add LiTTBits at litlabs.net to continue using the CLI.",
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
