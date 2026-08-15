/**
 * Remote command dispatcher — sends commands to terminal-server's
 * canonical CommandRouter via HTTP.
 *
 * When `--remote` is passed, the CLI doesn't run commands locally.
 * Instead it sends them to terminal-server, which:
 *   1. Dispatches through the SAME CommandRouter from @litt/agent-core
 *   2. Updates the canonical RuntimeStore
 *   3. Broadcasts state via Socket.IO to all connected clients (Studio, CLI)
 *
 * This means `litt build --remote` and `/build` in Studio execute
 * the same CommandRouter instance and share the same runId.
 */

import type { CommandResult } from "@litt/agent-core";

export interface RemoteDispatchOptions {
  terminalUrl?: string;
  internalKey?: string;
  cwd?: string;
}

export interface RemoteDispatchResult {
  ok: boolean;
  result: CommandResult;
  runId: string;
  timestamp: number;
}

const DEFAULT_TERMINAL_URL = "http://127.0.0.1:4001";

/**
 * Send a command to terminal-server's /internal/command endpoint.
 * Returns the CommandResult from the canonical CommandRouter.
 */
export async function dispatchRemote(
  command: string,
  args: Record<string, unknown> | undefined,
  options: RemoteDispatchOptions = {},
): Promise<RemoteDispatchResult> {
  const baseUrl = options.terminalUrl ?? process.env.LITT_TERMINAL_URL ?? DEFAULT_TERMINAL_URL;
  const key = options.internalKey ?? process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";

  if (key.length < 32) {
    throw new Error(
      "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars). " +
      "Set it in your environment or run without --remote for local execution.",
    );
  }

  const response = await fetch(`${baseUrl}/internal/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify({
      command,
      args,
      cwd: options.cwd ?? process.cwd(),
    }),
    signal: AbortSignal.timeout(240_000),
  });

  const payload = await response.json().catch(() => null) as RemoteDispatchResult & { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Remote command failed (${response.status})`);
  }

  if (!payload) {
    throw new Error("No response from terminal server");
  }

  return payload;
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
