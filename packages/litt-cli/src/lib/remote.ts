/**
 * Remote command dispatcher — sends commands to terminal-server's
 * canonical command dispatcher via HTTP.
 *
 * When `--remote` is passed, the CLI doesn't run commands locally.
 * Instead it sends them to terminal-server, which:
 *   1. Dispatches through the command registry / ExecutionGateway
 *      from @litt/agent-core
 *   2. Updates the canonical RuntimeStore
 *   3. Broadcasts state via Socket.IO to all connected clients (Studio, CLI)
 *
 * This means `litt build --remote` and `/build` in Studio execute
 * the same dispatcher and share the same runId.
 *
 * Authentication (token exchange flow):
 *   The CLI NEVER holds TERMINAL_AUTH_SECRET or CLERK_SECRET_KEY.
 *   Instead:
 *     1. The user provides a Clerk token (LITT_CLERK_TOKEN env var
 *        or obtained via `litt login`)
 *     2. The CLI sends the Clerk token to /api/token-exchange
 *     3. terminal-server verifies the Clerk token server-side
 *     4. terminal-server mints a short-lived terminal JWT (5 min)
 *     5. The CLI uses the terminal JWT for /api/command, /api/runtime, etc.
 *     6. The terminal JWT is cached and refreshed when it expires
 *
 * LITT_CLERK_TOKEN is a TEMPORARY acceptance-test auth mechanism.
 * It is NOT the final CLI login UX. The final UX will be `litt login`
 * which opens a browser-based Clerk OAuth flow and stores the session
 * token in the OS keychain. LITT_CLERK_TOKEN exists only to enable
 * automated acceptance tests and manual remote testing before the
 * full login flow is implemented. It should never be documented as
 * a user-facing feature.
 *
 * The internal service key (TERMINAL_INTERNAL_SERVICE_KEY) is NOT
 * used for user-facing CLI dispatch. That key is reserved for
 * service-to-service calls (Next.js → terminal-server).
 *
 * Protocol: imports the ONE shared `RemoteCommandRequest` /
 * `RemoteCommandResponse` contract from `@litt/agent-core`. The server
 * decodes the exact same schema. No duplicate interface definitions,
 * no triple-deref (`result.result.result.message`) — the response
 * `result` is a single-level `ToolResult`.
 */

import type {
  RemoteCommandRequest,
  RemoteCommandResponse,
  MissionMode,
} from "@litt/agent-core";
import { isRemoteError, hasRemoteResult } from "@litt/agent-core";
import { getTerminalUrl } from "./auth/auth-config.js";
import { RemoteUnavailableError } from "./remote-unavailable.js";

// Re-export for CLI consumers (index.ts imports these from remote.ts)
export { isRemoteError, hasRemoteResult };
export { RemoteUnavailableError, isRemoteUnavailable } from "./remote-unavailable.js";

export interface RemoteDispatchOptions {
  terminalUrl?: string;
  /** Clerk token for authentication (obtained via `litt login` or LITT_CLERK_TOKEN env) */
  clerkToken?: string;
  /** Pre-exchanged terminal JWT (skip token exchange if provided) */
  terminalToken?: string;
  cwd?: string;
  mode?: MissionMode;
  /** Workspace ID for workspace-scoped token caching. Different workspace = different token. */
  workspaceId?: string;
}

// ─── Terminal JWT cache (per-process) ─────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
  terminalUrl: string;
  workspaceId?: string;
}

let cachedTerminalToken: CachedToken | null = null;

/**
 * Exchange a Clerk token for a short-lived terminal JWT via
 * POST /api/token-exchange. The terminal JWT is cached and reused
 * until it expires (with a 30s safety margin).
 *
 * The client NEVER touches TERMINAL_AUTH_SECRET — the server mints
 * the terminal JWT using the secret, server-side.
 */
export async function exchangeClerkToken(
  clerkToken: string,
  terminalUrl: string = getTerminalUrl(),
  workspaceId?: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${terminalUrl}/api/token-exchange`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${clerkToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(workspaceId ? { workspaceId } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // DNS failure, connection refused, timeout — the service is not
    // reachable. Fail closed with the reason, never degrade to local.
    throw new RemoteUnavailableError(
      "service_unavailable",
      error instanceof Error ? `${error.message}.` : "Network error.",
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    // 401/403 mean the credential itself is bad — surface that distinctly
    // so the caller clears it rather than retrying with the same token.
    const reason = response.status === 401 || response.status === 403
      ? "auth_revoked"
      : "session_failed";
    throw new RemoteUnavailableError(
      reason,
      body?.error ?? `Token exchange failed (${response.status}).`,
    );
  }

  const payload = await response.json() as {
    terminalToken: string;
    expiresIn: number;
    userId: string;
  };

  // Cache with 30s safety margin, scoped to terminalUrl + workspaceId
  cachedTerminalToken = {
    token: payload.terminalToken,
    expiresAt: Date.now() + (payload.expiresIn - 30) * 1000,
    terminalUrl,
    workspaceId,
  };

  return payload.terminalToken;
}

/**
 * Get a valid terminal JWT, exchanging the Clerk token if needed.
 * Uses the cache if the token is still valid.
 *
 * The Clerk token is obtained from:
 *   1. options.clerkToken (explicit override)
 *   2. AuthSession.getAccessToken() — the real OAuth credential store
 *      (auto-refreshes if the access token is expired)
 *   3. LITT_CLERK_TOKEN env var (temporary — automated acceptance tests)
 */
async function getTerminalToken(options: RemoteDispatchOptions): Promise<string> {
  // Pre-exchanged token takes priority
  if (options.terminalToken) return options.terminalToken;

  const terminalUrl = options.terminalUrl ?? getTerminalUrl();

  // Check cache — only reuse if:
  //   1. Token is not expired
  //   2. terminalUrl matches (different server = different token)
  //   3. workspaceId matches (different workspace = different signed claim)
  // This prevents a token minted for workspace A from being reused for
  // workspace B, which would silently bind the command to the wrong project.
  if (
    cachedTerminalToken &&
    Date.now() < cachedTerminalToken.expiresAt &&
    cachedTerminalToken.terminalUrl === terminalUrl &&
    cachedTerminalToken.workspaceId === options.workspaceId
  ) {
    return cachedTerminalToken.token;
  }

  // Get the Clerk token — prefer explicit override, then AuthSession
  let clerkToken = options.clerkToken ?? "";
  if (!clerkToken) {
    // Use the AuthSession (OAuth credential store with auto-refresh)
    const { getAuthSession } = await import("./auth/auth-session.js");
    const authSession = getAuthSession();
    // Strict accessor: throws RemoteUnavailableError("auth_expired") when
    // credentials exist but refresh failed, instead of collapsing that
    // into an indistinguishable null. The distinction matters because an
    // expired session must also be CLEARED, not merely reported.
    clerkToken = await authSession.getAccessTokenStrict() ?? "";
  }

  if (!clerkToken) {
    // Fail closed. Note what this deliberately does NOT say: the previous
    // message suggested "run without --remote for local execution", which
    // nudged operators to silently relocate the command to a different
    // machine after an auth failure. Auth failure is never permission to
    // execute somewhere else.
    throw new RemoteUnavailableError("not_authenticated");
  }

  // Pass workspaceId so the server can embed it as a signed claim.
  // When no workspaceId is provided, the server auto-selects if exactly
  // one ready workspace exists, or returns a typed error.
  return exchangeClerkToken(clerkToken, terminalUrl, options.workspaceId);
}

/**
 * Send a command to terminal-server's /api/command endpoint.
 *
 * Uses the token exchange flow: the CLI sends a terminal JWT (obtained
 * by exchanging a Clerk token via /api/token-exchange). The server
 * verifies the terminal JWT and extracts userId from it — NOT from
 * the request body.
 *
 * Returns the canonical RemoteCommandResponse — the SAME schema the
 * server produces. Structured argv is preserved end-to-end (never
 * encoded into a shell string).
 */
export async function dispatchRemote(
  command: string,
  args: string[] = [],
  options: RemoteDispatchOptions = {},
): Promise<RemoteCommandResponse> {
  const baseUrl = options.terminalUrl ?? getTerminalUrl();
  const token = await getTerminalToken(options);

  const requestBody: RemoteCommandRequest = {
    command,
    args,
    mode: options.mode,
  };

  // Only pass cwd when the caller explicitly provides one. The
  // terminal-server will use the user's authorized workspace root when
  // cwd is omitted, which is the correct behavior for remote commands
  // that execute on the server's filesystem.
  if (options.cwd) {
    requestBody.cwd = options.cwd;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (error) {
    throw new RemoteUnavailableError(
      "service_unavailable",
      error instanceof Error ? `${error.message}.` : "Network error.",
    );
  }

  const payload = await response.json().catch(() => null) as
    | (RemoteCommandResponse & { error?: string | { code?: string; message?: string } })
    | null;

  if (!response.ok) {
    // HTTP-level failure (auth, 500, workspace errors, etc.).
    // The server may return a typed error object with a `code` field
    // (workspace_required, workspace_selection_required, workspace_unauthorized)
    // or a legacy string error.
    const typedError = payload?.error && typeof payload.error === "object"
      ? payload.error as { code?: string; message?: string }
      : undefined;
    const typedMessage = typedError?.message;
    const legacyMessage = typeof payload?.error === "string" ? payload.error : undefined;
    const detail = typedMessage ?? legacyMessage ?? `Remote command failed (${response.status}).`;

    // Check workspace error codes FIRST — before the generic 401/403 check.
    // workspace_unauthorized returns HTTP 403 but is NOT an auth revocation —
    // it means the workspace doesn't belong to the user. It must remain a
    // distinct reason so the CLI does NOT clear valid Clerk credentials
    // or tell the user to log in again.
    if (typedError?.code === "workspace_required") {
      throw new RemoteUnavailableError("workspace_required", detail);
    }
    if (typedError?.code === "workspace_selection_required") {
      throw new RemoteUnavailableError("workspace_selection_required", detail);
    }
    if (typedError?.code === "workspace_unauthorized") {
      throw new RemoteUnavailableError("workspace_unauthorized", detail);
    }

    if (response.status === 401 || response.status === 403) {
      throw new RemoteUnavailableError("auth_revoked", detail);
    }
    throw new RemoteUnavailableError("execution_failed", detail);
  }

  if (!payload) {
    throw new RemoteUnavailableError("service_unavailable", "No response from terminal server.");
  }

  return payload as RemoteCommandResponse;
}

/**
 * Check if the terminal-server is reachable and healthy.
 * Does NOT require authentication — just hits the public health endpoint.
 */
export async function isRemoteAvailable(
  options: { terminalUrl?: string } = {},
): Promise<boolean> {
  const baseUrl = options.terminalUrl ?? getTerminalUrl();
  try {
    const response = await fetch(`${baseUrl}/health/live`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Clear the cached terminal token. Called on disconnect or when
 * the user explicitly logs out.
 */
export function clearTerminalTokenCache(): void {
  cachedTerminalToken = null;
}
