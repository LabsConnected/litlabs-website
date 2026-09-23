import { isTerminalActionRunStatus } from "./state-machine";
import type { ActionRunStatus } from "./types";
import type { SessionStatus } from "@/lib/litt-intelligence/browser-session-manager";

export interface BrowserStatusProjectionOptions {
  /**
   * There is actual Action Runtime/browser execution in progress right
   * now (a browser tool is in flight) — NOT merely "a provider session
   * exists". Only this distinction lets a starting run advance to working.
   */
  isExecutionActive?: boolean;
}

export function projectBrowserSessionStatus(
  sessionStatus: SessionStatus,
  currentRunStatus: ActionRunStatus,
  options: BrowserStatusProjectionOptions = {},
): ActionRunStatus {
  // Terminal ActionRun truth is authoritative: a provider heartbeat,
  // error, or close must never rewrite completed/failed/cancelled history.
  if (isTerminalActionRunStatus(currentRunStatus)) return currentRunStatus;
  if (sessionStatus === "human_control") return "user_controlling";
  if (sessionStatus === "paused") return "paused";
  if (sessionStatus === "error") return "failed";
  if (sessionStatus === "closed") return "failed";
  if (sessionStatus === "active" || sessionStatus === "agent_control") {
    if (currentRunStatus === "starting") return options.isExecutionActive ? "working" : "starting";
    return currentRunStatus;
  }
  return currentRunStatus;
}
