import type { ActionRunStatus } from "./types";
import type { SessionStatus } from "@/lib/litt-intelligence/browser-session-manager";

export function projectBrowserSessionStatus(
  sessionStatus: SessionStatus,
  currentRunStatus: ActionRunStatus,
  agentExecuting = false,
): ActionRunStatus {
  if (sessionStatus === "human_control") return "user_controlling";
  if (sessionStatus === "paused") return "paused";
  if (sessionStatus === "error") return "failed";
  if (sessionStatus === "closed") {
    return currentRunStatus === "completed" ? "completed" : "failed";
  }
  if (sessionStatus === "active" || sessionStatus === "agent_control") {
    if (currentRunStatus === "starting") return agentExecuting ? "working" : "starting";
    return currentRunStatus;
  }
  return currentRunStatus;
}
