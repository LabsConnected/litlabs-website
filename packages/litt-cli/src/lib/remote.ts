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

export interface RemoteDispatchOptions {
  terminalUrl?: string;
  internalKey?: string;
  cwd?: string;
  mode?: MissionMode;
}

const DEFAULT_TERMINAL_URL = "http://127.0.0.1:4001";

/**
 * Send a command to terminal-server's /internal/command endpoint.
 * Returns the canonical RemoteCommandResponse — the SAME schema the
 * server produces. Structured argv is preserved end-to-end (never
 * encoded into a shell string).
 */
export async function dispatchRemote(
  command: string,
  args: string[] = [],
  options: RemoteDispatchOptions = {},
): Promise<RemoteCommandResponse> {
  const baseUrl = options.terminalUrl ?? process.env.LITT_TERMINAL_URL ?? DEFAULT_TERMINAL_URL;
  const key = options.internalKey ?? process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";

  if (key.length < 32) {
    throw new Error(
      "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars). " +
      "Set it in your environment or run without --remote for local execution.",
    );
  }

  const requestBody: RemoteCommandRequest = {
    command,
    args,
    cwd: options.cwd ?? process.cwd(),
    mode: options.mode,
  };

  const response = await fetch(`${baseUrl}/internal/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
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
 * Check if terminal-server is reachable.
 */
export async function isRemoteAvailable(options: RemoteDispatchOptions = {}): Promise<boolean> {
  const baseUrl = options.terminalUrl ?? process.env.LITT_TERMINAL_URL ?? DEFAULT_TERMINAL_URL;
  try {
    const res = await fetch(`${baseUrl}/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Re-export the type guards so callers (index.ts) can branch on typed
// errors without re-importing from agent-core.
export { isRemoteError, hasRemoteResult };
