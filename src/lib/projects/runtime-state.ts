/**
 * Canonical ProjectRuntimeState — the ONE source of truth for the active
 * project's runtime status across the entire Studio.
 *
 * Every Studio panel (header, terminal, health, files, preview, activity rail,
 * LiTT conversation tools) must consume this state instead of calculating
 * readiness independently.
 *
 * Server-side resolution: /api/project-runtime
 * Client-side hook: useProjectRuntime
 */

export type RuntimePhase =
  | "idle" // no project selected
  | "resolving" // resolving project + workspace
  | "ready" // workspace mounted, terminal connected, execution available
  | "workspace_not_provisioned" // project exists but no workspaceId
  | "workspace_not_ready" // workspaceId exists but workspaceStatus !== "ready"
  | "terminal_disconnected" // workspace ready but terminal not connected
  | "terminal_reconnecting" // attempting to reconnect terminal
  | "error" // unrecoverable error
  | "unauthenticated"; // no user

export interface ProjectRuntimeError {
  code: string;
  message: string;
  recoveryAction?: string;
  recoveryHref?: string;
}

export interface ProjectRuntimeState {
  /** Current phase of the runtime — single source of truth for "is it ready" */
  phase: RuntimePhase;
  /** True only when workspace is mounted AND terminal is connected */
  executionAvailable: boolean;
  /** True when workspace is provisioned and status is "ready" */
  workspaceProvisioned: boolean;
  /** True when terminal WebSocket is connected */
  terminalConnected: boolean;

  /** Project identity */
  projectId: string | null;
  projectName: string | null;
  repository: string | null;
  branch: string | null;

  /** Workspace identity */
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceStatus: string | null;

  /** Terminal identity */
  terminalSessionId: string | null;

  /** Access flags */
  readAccess: boolean;
  writeAccess: boolean;
  writeApprovalRequired: boolean;

  /** Timestamp of last resolution */
  lastCheckedAt: string;

  /** Error details if phase is "error" or a sub-state */
  error?: ProjectRuntimeError;
}

export const INITIAL_RUNTIME_STATE: ProjectRuntimeState = {
  phase: "idle",
  executionAvailable: false,
  workspaceProvisioned: false,
  terminalConnected: false,
  projectId: null,
  projectName: null,
  repository: null,
  branch: null,
  workspaceId: null,
  workspacePath: null,
  workspaceStatus: null,
  terminalSessionId: null,
  readAccess: false,
  writeAccess: false,
  writeApprovalRequired: true,
  lastCheckedAt: new Date(0).toISOString(),
};

/**
 * Human-readable summary for the runtime phase.
 * Used by the Studio header and health panel.
 */
export function runtimePhaseLabel(phase: RuntimePhase): string {
  switch (phase) {
    case "idle":
      return "No project selected";
    case "resolving":
      return "Resolving workspace…";
    case "ready":
      return "Workspace ready";
    case "workspace_not_provisioned":
      return "Workspace not provisioned";
    case "workspace_not_ready":
      return "Workspace not ready";
    case "terminal_disconnected":
      return "Terminal disconnected";
    case "terminal_reconnecting":
      return "Reconnecting terminal…";
    case "error":
      return "Runtime error";
    case "unauthenticated":
      return "Sign in required";
  }
}

/**
 * Recovery actions for each non-ready phase.
 * The Studio header and health panel use this to show actionable buttons
 * instead of "Project workspace is not ready."
 */
export function runtimeRecoveryActions(
  phase: RuntimePhase,
): Array<{ label: string; action: string; href?: string }> {
  switch (phase) {
    case "workspace_not_provisioned":
      return [
        { label: "Provision workspace", action: "provision_workspace" },
        { label: "Open connection settings", action: "open_settings", href: "/settings" },
      ];
    case "workspace_not_ready":
      return [
        { label: "Retry workspace", action: "retry_workspace" },
        { label: "Re-clone repository", action: "reclone_repo" },
        { label: "Select another branch", action: "select_branch" },
      ];
    case "terminal_disconnected":
      return [
        { label: "Reconnect terminal", action: "reconnect_terminal" },
        { label: "Open connection settings", action: "open_settings", href: "/settings" },
      ];
    case "terminal_reconnecting":
      return [];
    case "error":
      return [
        { label: "Retry", action: "retry_runtime" },
        { label: "Open connection settings", action: "open_settings", href: "/settings" },
      ];
    case "unauthenticated":
      return [{ label: "Sign in", action: "sign_in", href: "/sign-in" }];
    default:
      return [];
  }
}
