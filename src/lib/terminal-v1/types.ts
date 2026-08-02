/**
 * Canonical server-side types for Terminal V1.
 *
 * These types are the single source of truth for sandbox, workspace,
 * and terminal session state. The frontend must not infer states from
 * timers — it reads these states from the server.
 */

// ─── Sandbox States ──────────────────────────────────────────────

export type SandboxState =
  | "requested"
  | "provisioning"
  | "ready"
  | "connecting"
  | "running"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed"
  | "deleting"
  | "deleted";

// ─── Sandbox Resource Limits ─────────────────────────────────────

export interface SandboxResourceLimits {
  cpuVcpus: number;
  memoryMB: number;
  processLimit: number;
  diskGB: number;
  idleTimeoutMinutes: number;
  maxSessionMinutes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxResourceLimits = {
  cpuVcpus: 1,
  memoryMB: 1024,
  processLimit: 100,
  diskGB: 5,
  idleTimeoutMinutes: 15,
  maxSessionMinutes: 120,
};

// ─── Sandbox Usage ───────────────────────────────────────────────

export interface SandboxUsage {
  sandboxId: string;
  cpuSeconds: number;
  memoryMBSeconds: number;
  diskGBHours: number;
  networkInBytes: number;
  networkOutBytes: number;
  sessionStart: string;
  sessionEnd: string | null;
}

// ─── Sandbox Instance ────────────────────────────────────────────

export interface SandboxInstance {
  sandboxId: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  state: SandboxState;
  limits: SandboxResourceLimits;
  createdAt: string;
  startedAt: string | null;
  lastActiveAt: string;
  stoppedAt: string | null;
  failureReason: string | null;
  provider: string;
  endpoint: string | null;
}

// ─── Workspace ───────────────────────────────────────────────────

export type WorkspaceState =
  | "initial"
  | "cloning"
  | "ready"
  | "error"
  | "deleted";

export interface Workspace {
  workspaceId: string;
  userId: string;
  projectId: string;
  sandboxProvider: string;
  currentSandboxId: string | null;
  storageVolumeId: string | null;
  gitSource: "github" | "blank" | null;
  gitOwner: string | null;
  gitRepo: string | null;
  gitBranch: string | null;
  lastCommitSha: string | null;
  state: WorkspaceState;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  storageUsageBytes: number;
  failureReason: string | null;
}

// ─── Terminal Session ────────────────────────────────────────────

export interface TerminalSession {
  sessionId: string;
  sandboxId: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  shell: ShellType;
  state: TerminalConnectionState;
  startedAt: string;
  endedAt: string | null;
  cols: number;
  rows: number;
}

export type TerminalConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type ShellType = "bash" | "pwsh";

// ─── Terminal Transport ──────────────────────────────────────────

export interface TerminalTransport {
  sessionId: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onOutput: (callback: (data: string) => void) => void;
  onExit: (callback: (info: { exitCode: number; signal?: number }) => void) => void;
  kill: () => void;
}

// ─── Terminal Connect Options ────────────────────────────────────

export interface TerminalConnectOptions {
  shell: ShellType;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

// ─── Execute Command ─────────────────────────────────────────────

export interface ExecuteCommandInput {
  command: string;
  stdin?: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface ExecuteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ─── Preview Port ────────────────────────────────────────────────

export type PreviewPortState =
  | "closed"
  | "requesting"
  | "private"
  | "public"
  | "expired"
  | "revoked"
  | "failed";

export interface PreviewEndpoint {
  port: number;
  url: string;
  state: PreviewPortState;
  previewToken: string;
  expiresAt: string;
}

// ─── Create Sandbox Input ────────────────────────────────────────

export interface CreateSandboxInput {
  workspaceId: string;
  userId: string;
  projectId: string;
  limits?: Partial<SandboxResourceLimits>;
  env?: Record<string, string>;
}

// ─── Token Types ─────────────────────────────────────────────────

export type TerminalTokenScope =
  | "terminal:connect"
  | "terminal:input"
  | "terminal:resize"
  | "files:read"
  | "files:write"
  | "preview:open";

export interface TerminalTokenClaims {
  sub: string;
  pid: string;
  wid: string;
  sid: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  scope: TerminalTokenScope[];
}

export interface TerminalToken {
  token: string;
  claims: TerminalTokenClaims;
  expiresAt: number;
}
