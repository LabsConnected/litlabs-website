export type CapabilityStatus =
  | "unavailable"
  | "not_configured"
  | "connecting"
  | "validating"
  | "ready"
  | "running"
  | "degraded"
  | "error";

export interface Capability {
  id: string;
  name: string;
  label?: string;
  status: CapabilityStatus;
  error?: string;
  provider?: string;
  accountName?: string;
  projectId?: string;
  projectName?: string;
  defaultBranch?: string;
  activeBranch?: string;
  lastVerifiedAt?: string;
}

export interface CapabilitySummary {
  capabilities: Capability[];
  readiness: Array<{
    group: { id: string; name: string; requirements: Array<{ id: string; label: string }> };
    satisfied: Capability[];
    missing: Capability[];
    isReady: boolean;
  }>;
}

export type TerminalStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "unavailable"
  | "project_context_missing"
  | "pty_failed"
  | "auth_failed";

/**
 * The specific stage where terminal connection failed.
 * Used for diagnostics and for LiTTAI to report the actual failure reason.
 */
export type TerminalFailureStage =
  | null
  | "auth" // Clerk session or terminal token auth failed
  | "project_unresolved" // No canonical project record
  | "workspace_not_provisioned" // No workspaceId for the project
  | "workspace_not_ready" // workspaceId exists but status !== "ready"
  | "workspace_provisioning_failed" // prepare endpoint returned an error
  | "socket_unavailable" // WebSocket/Socket.IO connection failed
  | "pty_creation_failed" // session:ready never arrived or returned error
  | "pty_timeout" // PTY connection timed out waiting for session:ready
  | "cwd_verification_failed" // PTY cwd does not match expected workspace
  | "heartbeat_stale"; // Heartbeat timed out

export interface TerminalDiagnostics {
  canonicalProjectId: string | null;
  repository: string | null;
  branch: string | null;
  workspaceId: string | null;
  workspaceStatus: string | null;
  socketConnected: boolean;
  ptyReady: boolean;
  cwd: string | null;
  shell: string | null;
  failureStage: TerminalFailureStage;
  lastError: string | null;
  lastDisconnectReason: string | null;
  lastCheckedAt: string | null;
}

export interface TerminalConnectionState {
  status: TerminalStatus;
  sessionId: string | null;
  projectId: string | null;
  workspaceId: string | null;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  error: string | null;
  /** Verified cwd from session:ready — only set when PTY is truly ready */
  cwd: string | null;
  /** Shell type from session:ready */
  shell: string | null;
  /** Specific failure stage for diagnostics and LiTTAI reporting */
  failureStage: TerminalFailureStage;
  /** Last disconnect reason from Socket.IO */
  lastDisconnectReason: string | null;
}

export interface TerminalCapability {
  id: "project-terminal";
  status: CapabilityStatus;
  terminalStatus: TerminalStatus;
  sessionId: string | null;
  projectId: string | null;
  workspaceId: string | null;
  lastVerifiedAt: string | null;
  error: string | null;
}

export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const CONNECT_TIMEOUT_MS = 10_000;
export const HEARTBEAT_STALE_MS = 20_000;

export function isTerminalUsable(state: TerminalConnectionState): boolean {
  return (
    state.status === "connected" &&
    state.sessionId !== null &&
    state.cwd !== null &&
    state.lastHeartbeatAt !== null &&
    Date.now() - new Date(state.lastHeartbeatAt).getTime() < HEARTBEAT_TIMEOUT_MS
  );
}

export function terminalStatusToCapability(
  state: TerminalConnectionState,
): TerminalCapability {
  let capStatus: CapabilityStatus;
  switch (state.status) {
    case "connected":
      capStatus = isTerminalUsable(state) ? "ready" : "degraded";
      break;
    case "connecting":
      capStatus = "connecting";
      break;
    case "error":
    case "pty_failed":
    case "auth_failed":
      capStatus = "error";
      break;
    case "project_context_missing":
      capStatus = "error";
      break;
    case "unavailable":
      capStatus = "unavailable";
      break;
    default:
      capStatus = "unavailable";
  }
  return {
    id: "project-terminal",
    status: capStatus,
    terminalStatus: state.status,
    sessionId: state.sessionId,
    projectId: state.projectId,
    workspaceId: state.workspaceId,
    lastVerifiedAt: state.lastHeartbeatAt,
    error: state.error,
  };
}
