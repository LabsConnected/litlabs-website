/**
 * Command bridge — routes web/CLI command requests through the canonical
 * CommandRouter from @litt/agent-core, wired to the same RuntimeStore
 * that terminal-server already owns.
 *
 * This is the ONE place where HTTP requests become CommandRouter calls.
 * Both Studio Web and `litt --remote` hit this path.
 *
 *   POST /internal/command
 *         ↓
 *   CommandBridge.dispatch()
 *         ↓
 *   CommandRouter (agent-core)
 *         ↓
 *   RuntimeStore updates → Socket.IO broadcasts
 *         ↓
 *   Studio / CLI / PowerShell all see the same run
 */

import type { CommandResult } from "@litt/agent-core";
import { getWorkspace } from "./workspace/WorkspaceManager.js";
import {
  dispatchRegistry,
  resolveCommand,
  getCommandNames,
  type CommandContext,
  type CommandResponse,
} from "./command-registry.js";

// ─── Command request/response types ───────────────────────────────

export interface CommandRequest {
  /** Slash command (e.g. "/status") or bare command (e.g. "status") */
  command: string;
  args?: Record<string, unknown>;
  workspaceId?: string;
  cwd?: string;
  userId?: string | null;
}

export interface CommandBridgeResult {
  ok: boolean;
  kind: string;
  data: unknown;
  message?: string;
  runId: string;
  timestamp: number;
  durationMs: number;
}

// ─── Dispatch ─────────────────────────────────────────────────────

/**
 * Dispatch a command through the canonical command registry.
 * This is the ONE dispatch path — both slash commands and bare commands
 * route through the same registry.
 *
 * The RuntimeStore is updated by individual handlers that use CommandRouter.
 */
export async function dispatchCommand(req: CommandRequest): Promise<CommandBridgeResult> {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = Date.now();

  // Resolve cwd: explicit > workspace root > server cwd
  let cwd = req.cwd ?? process.cwd();
  if (req.workspaceId) {
    const ws = getWorkspace(req.workspaceId);
    if (ws) {
      cwd = ws.root;
    }
  }

  const ctx: CommandContext = {
    cwd,
    userId: req.userId ?? null,
    workspaceId: req.workspaceId,
    rawInput: req.command,
  };

  const response: CommandResponse = await dispatchRegistry(req.command, ctx);

  return {
    ok: response.ok,
    kind: response.kind,
    data: response.data,
    message: response.message,
    runId,
    timestamp,
    durationMs: response.durationMs,
  };
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

// Re-export for backward compatibility
export type { CommandResult };

