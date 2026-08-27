/**
 * Command bridge — routes web/CLI/Termux command requests through the
 * canonical command registry from @litt/agent-core, wired to the same
 * RuntimeStore that terminal-server already owns.
 *
 * This is the ONE place where HTTP requests become command dispatches.
 * Both Studio Web, `litt --remote`, and the PowerShell cockpit hit
 * this path.
 *
 *   POST /internal/command
 *         ↓  RemoteCommandRequest  (structured argv — never shell-string)
 *   CommandBridge.dispatch()
 *         ↓
 *   command-registry  (read-only / project commands)
 *   ExecutionGateway  (mutating commands like /do → project.run)
 *         ↓
 *   RuntimeStore updates → Socket.IO broadcasts
 *         ↓
 *   RemoteCommandResponse  (same runId as the runtime execution)
 *         ↓
 *   Studio / CLI / Termux / Desktop observers
 *
 * Protocol: imports the ONE shared `RemoteCommandRequest` /
 * `RemoteCommandResponse` contract from `@litt/agent-core`. No
 * duplicate interface definitions here.
 */

import {
  resolveCommand,
  getCommandNames,
  dispatchRegistry,
  type CommandContext,
  type CommandResponse,
} from "./command-registry";
import { getWorkspace } from "./workspace/WorkspaceManager";
import { getRunRegistry } from "./run-registry.js";
import {
  successResponse,
  errorResponse,
  type RemoteCommandRequest,
  type RemoteCommandResponse,
} from "@litt/agent-core";

// ─── Dispatch ─────────────────────────────────────────────────────

/**
 * Dispatch a remote command through the canonical command registry.
 * This is the ONE dispatch path — both slash commands and bare commands
 * route through the same registry.
 *
 * The runId generated here is passed THROUGH to the registry handlers
 * so the RuntimeStore records the SAME runId. No second execution
 * identity is minted.
 */
export async function dispatchCommand(
  req: RemoteCommandRequest,
  options?: { runId?: string },
): Promise<RemoteCommandResponse> {
  const runId = options?.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = Date.now();
  const requestId = req.requestId;

  // ─── Validate the request ────────────────────────────────────
  if (!req.command || typeof req.command !== "string") {
    return errorResponse({
      runId,
      requestId,
      code: "malformed_request",
      message: "Missing 'command' field",
      timestamp,
    });
  }

  // ─── Resolve cwd: explicit > workspace root > server cwd ─────
  let cwd = req.cwd ?? process.cwd();
  if (req.workspaceId) {
    const ws = getWorkspace(req.workspaceId);
    if (ws) {
      cwd = ws.root;
    }
  }

  // ─── Reject unknown commands with a typed error ──────────────
  // resolveCommand returns null for commands not in the registry.
  // We fail cleanly with `unknown_command` + the available list so
  // clients can branch on `error.code` instead of crashing.
  if (resolveCommand(req.command) === null) {
    const trimmed = req.command.trim();
    const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const cmdName = withoutSlash.split(/\s+/)[0] ?? "";
    return errorResponse({
      runId,
      requestId,
      code: "unknown_command",
      message: `Unknown command: /${cmdName}. Type /help for available commands.`,
      availableCommands: getCommandNames(),
      timestamp,
    });
  }

  // ─── Build the command context ───────────────────────────────
  // The runId is passed through so registry handlers can forward it
  // to CommandRouter methods (check/test/build accept runId) and to
  // the ExecutionGateway (for /do). This is what makes the response
  // runId == the runtime execution runId.
  const ctx: CommandContext = {
    cwd,
    userId: req.userId ?? null,
    workspaceId: req.workspaceId,
    rawInput: req.command,
    runId,
    mode: req.mode ?? "act",
  };

  // ─── Dispatch through the registry ───────────────────────────
  // dispatchRegistry receives the RAW command string (which encodes
  // any inline args like "/diff --staged"). The structured `args`
  // from the request are appended so both inline and structured argv
  // are preserved. Handlers receive the merged args array.
  try {
    const response: CommandResponse = await dispatchRegistry(
      req.command,
      ctx,
      req.args,
    );

    return successResponse({
      runId,
      requestId,
      ok: response.ok,
      kind: response.kind,
      message: response.message ?? "",
      data: (response.data as Record<string, unknown>) ?? {},
      durationMs: response.durationMs,
      timestamp,
    });
  } finally {
    // Clean up the registry entry so the map does not grow unbounded.
    // If the run was cancelled, cancel() already removed the entry.
    getRunRegistry().unregister(runId);
  }
}

// ─── Supported commands (registry-derived) ────────────────────────

/**
 * Check if a command is supported. Derives from the registry — no
 * duplicated static list.
 */
export function isSupportedCommand(cmd: string): boolean {
  return resolveCommand(cmd) !== null;
}

/**
 * Get all supported command names. Derives from the registry.
 */
export function getSupportedCommands(): string[] {
  return getCommandNames();
}
