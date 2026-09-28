/**
 * Station Control Bridge — terminal station adapter (chunk B, server-only).
 *
 * Thin adapter over the real LiTT tool. No business logic lives here:
 * execute delegates to the tool registry (real I/O) or returns an honest
 * failure — never a placeholder success.
 *
 * Delegate map:
 * - terminal.execute → terminal.execute ({command, projectId})
 *
 * CURRENT BACKEND STATE (reported): the underlying terminal.execute tool is
 * registered with enabled:false AND approvalPolicy NEVER_ALLOW_APPROVAL
 * (tool-registry.ts) — the registry refuses every call ("disabled" /
 * "quarantined") before any handler runs. The handler itself is real
 * (tool-handlers-v2.ts handleTerminalExecute → transport.exec). So this
 * station action is registered and delegates honestly, but every call
 * surfaces the registry's refusal until the tool is re-enabled — a
 * product/policy decision, not an adapter gap. No bypass is implemented
 * here; quarantined means quarantined.
 *
 * SHAPE DIFFERENCE (reported): the contract lists {command, cwd?}, but the
 * backend takes no cwd (handleTerminalExecute ignores it; commands run in
 * the workspace root). A cwd is accepted for contract fidelity but FAILS
 * HONESTLY when provided, rather than silently running elsewhere.
 *
 * DELIBERATELY OMITTED (no backend — documented, never stubbed):
 * - terminal.cancel — no cancel path exists in the transport; execute
 *   returns its output synchronously.
 * - terminal.read   — no named read tool exists; output returns with execute.
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import { delegateToTool } from "../delegate";
import { setDelegateToolId } from "../advertise";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import { fail, stationResultSchema } from "./creator-helpers";

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown. The executor safeParses raw args
 * against argsSchema before invoking execute, so the cast to the erased
 * StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

const terminalExecute = delegateToTool("terminal.execute");

defineAction({
  id: "terminal.execute",
  station: "terminal",
  description:
    "Execute a shell command in the project workspace (delegates to the real terminal.execute → " +
    "transport.exec, 30s timeout; returns stdout/stderr/exitCode). " +
    "NOTE: the underlying tool is currently disabled and quarantined in the tool registry, so calls " +
    "fail honestly with the registry's refusal until it is re-enabled. " +
    "cwd is not supported by the backend — commands run in the workspace root.",
  argsSchema: z.object({
    command: z.string().min(1).describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory (NOT supported by the backend)"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.cwd) {
      return fail(
        "terminal.execute does not support cwd: the backend runs every command in the workspace root. " +
          "Call without cwd.",
        "invalid_args",
      );
    }
    const projectId = ctx.projectId;
    if (!projectId) {
      return fail("terminal.execute requires an active project: station context has no projectId.", "not_configured");
    }
    return terminalExecute({ command: args.command, projectId }, ctx);
  },
});
setDelegateToolId("terminal.execute", "terminal.execute");

// terminal.cancel and terminal.read are deliberately NOT registered (see header).

export const TERMINAL_STATION_ACTIONS = ["terminal.execute"] as const;
