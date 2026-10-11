/**
 * HTTP mapping for fail-closed host-execution refusals.
 *
 * Kept out of server.ts so route behaviour can be tested against the exact
 * code the server runs, without booting the whole server.
 */
import type { Response } from "express";
import { HostExecutionBlockedError } from "./isolation-policy";

/** Map a fail-closed refusal to HTTP 503 HOST_EXECUTION_DISABLED. */
export function respondIfHostExecBlocked(err: unknown, res: Response): boolean {
  if (!(err instanceof HostExecutionBlockedError)) return false;
  res.status(503).json({ error: err.message, code: err.hostExecCode });
  return true;
}

/**
 * Run a command dispatch and write the HTTP response: result as JSON, a
 * blocked execution as 503 HOST_EXECUTION_DISABLED, anything else as 500.
 * Shared by /api/command and /internal/command.
 */
export async function respondWithDispatch(
  res: Response,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    res.json(await run());
  } catch (err) {
    if (respondIfHostExecBlocked(err, res)) return;
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
