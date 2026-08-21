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

// Re-export for CLI consumers (index.ts imports these from remote.ts)
export { isRemoteError, hasRemoteResult };

export interface RemoteDispatchOptions {
  terminalUrl?: string;
  /** Clerk token for authentication (obtained via `litt login` or LITT_CLERK_TOKEN env) */
  clerkToken?: string;
  /** Pre-exchanged terminal JWT (skip token exchange if provided) */
  terminalToken?: string;
  cwd?: string;
  mode?: MissionMode;
}

// ─── Terminal JWT cache (per-process) ─────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
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
): Promise<string> {
  const response = await fetch(`${terminalUrl}/api/token-exchange`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${clerkToken}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Token exchange failed (${response.status})`);
  }

  const payload = await response.json() as {
    terminalToken: string;
    expiresIn: number;
    userId: string;
  };

  // Cache with 30s safety margin
  cachedTerminalToken = {
    token: payload.terminalToken,
    expiresAt: Date.now() + (payload.expiresIn - 30) * 1000,
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

  // Check cache
  if (cachedTerminalToken && Date.now() < cachedTerminalToken.expiresAt) {
    return cachedTerminalToken.token;
  }

  // Get the Clerk token — prefer explicit override, then AuthSession
  let clerkToken = options.clerkToken ?? "";
  if (!clerkToken) {
    // Use the AuthSession (OAuth credential store with auto-refresh)
    const { getAuthSession } = await import("./auth/auth-session.js");
    const authSession = getAuthSession();
    clerkToken = await authSession.getAccessToken() ?? "";
  }

  if (!clerkToken) {
    throw new Error(
      "Not authenticated. Run `litt login` to sign in. " +
      "Run without --remote for local execution.",
    );
  }

  const terminalUrl = options.terminalUrl ?? getTerminalUrl();
  return exchangeClerkToken(clerkToken, terminalUrl);
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
    cwd: options.cwd ?? process.cwd(),
    mode: options.mode,
  };

  const response = await fetch(`${baseUrl}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(240_000),
  });

  const payload = await response.json().catch(() => null) as
    | (RemoteCommandResponse & { error?: string })
    | null;

  if (!response.ok) {
    // HTTP-level failure (auth, 500, etc.). The server may still return
    // a partial RemoteCommandResponse shape with a top-level `error`
    // string (legacy) — prefer the typed `error.code` if present.
    const typedMessage = payload?.error && typeof payload.error === "object"
      ? (payload.error as { message?: string }).message
      : undefined;
    const legacyMessage = typeof payload?.error === "string" ? payload.error : undefined;
    throw new Error(typedMessage ?? legacyMessage ?? `Remote command failed (${response.status})`);
  }

  if (!payload) {
    throw new Error("No response from terminal server");
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
