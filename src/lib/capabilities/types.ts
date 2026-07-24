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
  | "error";

export interface TerminalConnectionState {
  status: TerminalStatus;
  sessionId: string | null;
  projectId: string | null;
  workspaceId: string | null;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  error: string | null;
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

export function isTerminalUsable(state: TerminalConnectionState): boolean {
  return (
    state.status === "connected" &&
    state.sessionId !== null &&
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
      capStatus = "error";
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
