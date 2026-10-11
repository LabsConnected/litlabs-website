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
 * CURRENT BACKEND STATE (verified): the underlying terminal.execute tool is
 * enabled with the TERMINAL_APPROVAL registry policy, and the permission
 * engine classifies every command via terminal-command-policy.ts:
 * safe → auto-run, risky → approval, deny → never executes. The handler
 * itself is real (tool-handlers-v2.ts handleTerminalExecute →
 * transport.exec).
 *
 * SECURITY ORDERING NOTE: this action delegates with hasApproval: true (see
 * delegate.ts), so the registry's requireExplicitForMutations backstop cannot
 * catch deny-classified commands — it only checks the flag, not the command
 * text. Therefore the adapter classifies FIRST and fails honestly on deny
 * before delegating. Risky commands are NOT re-gated here: this action is
 * `mutating: true`, so the station runtime's own approval gate already covers
 * them, and inventing a second gate would just fork the approval UX.
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
import { classifyTerminalCommand } from "@/lib/litt-intelligence/terminal-command-policy";
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
    "Commands are policy-classified before execution: read-only commands auto-run, " +
    "mutation commands require the station's approval gate, and destructive " +
    "commands are refused honestly. " +
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
    // Deny check FIRST: this delegate passes hasApproval: true, so the
    // registry backstop cannot refuse destructive commands. Deny-classified
    // commands never reach the real handler, even with approval.
    const risk = classifyTerminalCommand(args.command);
    if (risk === "deny") {
      return fail(
        "terminal.execute refused: command is blocked by the terminal command policy " +
          "(destructive commands never execute, even with approval).",
        "permission_denied",
      );
    }
    // Risky commands flow through this action's EXISTING mutating:true
    // approval gate (station runtime pauses for approval before execute) —
    // no second gate here.
    return terminalExecute({ command: args.command, projectId }, ctx);
  },
});
setDelegateToolId("terminal.execute", "terminal.execute");

// terminal.cancel and terminal.read are deliberately NOT registered (see header).

export const TERMINAL_STATION_ACTIONS = ["terminal.execute"] as const;
