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
import { getWorkspaceRoot } from "./workspace/WorkspaceManager";
import { resolveOwnedCwd } from "./workspace/owned-cwd";
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

  // ─── Resolve the workspace under caller ownership ────────────
  // /internal/command is authenticated by the internal service key, so the
  // caller asserts `userId` on behalf of an end user. That makes this the
  // only place workspace ownership can be enforced — and it previously was
  // not: any workspaceId resolved to its root through the unchecked
  // getWorkspace(), letting one signed-in user name another tenant's
  // workspace and run read commands inside it.
  //
  // A workspace is now resolved ONLY through the owning user, and a
  // caller-supplied cwd is honoured ONLY relative to that owned root.
  let cwd = process.cwd();

  if (req.workspaceId) {
    // Ownership cannot be established without a user to compare against,
    // so an unattributed request is refused rather than trusted.
    if (!req.userId) {
      return errorResponse({
        runId,
        requestId,
        code: "workspace_unauthorized",
        message: "Workspace access requires an authenticated user.",
        timestamp,
      });
    }

    // Unknown and not-owned are deliberately indistinguishable: telling a
    // caller which workspace ids exist is itself a disclosure.
    const ownedRoot = getWorkspaceRoot(req.workspaceId, req.userId);
    if (!ownedRoot) {
      return errorResponse({
        runId,
        requestId,
        code: "workspace_unauthorized",
        message: "Workspace not found or not accessible.",
        timestamp,
      });
    }

    const resolvedCwd = resolveOwnedCwd(ownedRoot, req.cwd);
    if (!resolvedCwd.ok) {
      // The message names no path — not the workspace root, not the
      // rejected target.
      return errorResponse({
        runId,
        requestId,
        code: "workspace_unauthorized",
        message: "The requested working directory is outside the workspace.",
        timestamp,
      });
    }
    cwd = resolvedCwd.cwd;
  } else if (typeof req.cwd === "string" && req.cwd.trim() !== "") {
    // A directory cannot be requested without naming the owned workspace it
    // belongs to; otherwise an absolute cwd would select any path on the
    // container. Commands that need no workspace still run in the server cwd.
    return errorResponse({
      runId,
      requestId,
      code: "workspace_required",
      message: "A workspaceId is required when a working directory is specified.",
      timestamp,
    });
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
