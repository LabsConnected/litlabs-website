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

import { CommandRouter, createShellExecutor } from "@litt/agent-core";
import type { CommandResult } from "@litt/agent-core";
import { getRuntimeStore } from "./runtime.js";
import { getWorkspace } from "./workspace/WorkspaceManager.js";

// ─── Singleton CommandRouter ──────────────────────────────────────

let defaultRouter: CommandRouter | null = null;

/**
 * Get a CommandRouter wired to the canonical RuntimeStore.
 * The cwd is resolved per-request from the workspace, not globally.
 */
function getRouter(cwd: string, userId: string | null): CommandRouter {
  const store = getRuntimeStore();
  const shell = createShellExecutor(cwd);
  return new CommandRouter(shell, {
    cwd,
    userId,
    store,
  });
}

// ─── Command request/response types ───────────────────────────────

export interface CommandRequest {
  command: "status" | "diff" | "check" | "test" | "build" | "debug" | "ship" | "log" | "branch" | "list_files" | "read_file" | "search" | "inspect_package";
  args?: Record<string, unknown>;
  workspaceId?: string;
  cwd?: string;
  userId?: string | null;
}

export interface CommandBridgeResult {
  ok: boolean;
  result: CommandResult;
  runId: string;
  timestamp: number;
}

// ─── Dispatch ─────────────────────────────────────────────────────

/**
 * Dispatch a command through the canonical CommandRouter.
 * The RuntimeStore is updated automatically by CommandRouter,
 * which triggers Socket.IO broadcasts to all connected clients.
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

  const router = getRouter(cwd, req.userId ?? null);

  // Pass runId through to the router so it threads into RuntimeStore.
  // This is the shared identity across CLI, Studio, and Socket.IO clients.
  const dispatchArgs = { ...req.args, runId };

  try {
    const result = await router.dispatch(req.command, dispatchArgs);

    return {
      ok: result.result.success,
      result,
      runId,
      timestamp,
    };
  } catch (err) {
    throw err;
  }
}

// ─── Supported commands metadata ──────────────────────────────────

export const SUPPORTED_COMMANDS = [
  "status",
  "diff",
  "check",
  "test",
  "build",
  "debug",
  "ship",
  "log",
  "branch",
  "list_files",
  "read_file",
  "search",
  "inspect_package",
] as const;

export function isSupportedCommand(cmd: string): boolean {
  return (SUPPORTED_COMMANDS as readonly string[]).includes(cmd);
}
