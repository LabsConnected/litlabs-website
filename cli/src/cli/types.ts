export interface CliConfig {
  /** Clerk session token for API auth */
  clerkToken?: string;
  /** Last used project ID */
  projectId?: string;
  /** Preferred model */
  model?: string;
  /** Auto-confirm terminal commands (dangerous) */
  autoConfirm?: boolean;
}

export interface GitInfo {
  isRepo: boolean;
  root: string;
  branch: string | null;
  remote?: string;
}

export interface ProjectInfo {
  projectId: string | null;
  projectName: string | null;
  repository: string | null;
  branch: string | null;
}

export interface RuntimeContext {
  cwd: string;
  git: GitInfo;
  project: ProjectInfo;
  terminalAvailable: boolean;
  writeAccess: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
}

export interface ToolActivity {
  type: "reading" | "searching" | "running" | "writing" | "testing" | "waiting" | "thinking";
  label: string;
  timestamp: number;
}

export interface LiTTRunResponse {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  reasoning?: string;
  actions?: unknown[];
}

export interface LiTTStreamEvent {
  type: "text" | "reasoning" | "done" | "error";
  text?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  actions?: unknown[];
  reasoning?: string;
  message?: string;
  partialText?: string;
}

export const CLI_VERSION = "0.1.0";
export const CLI_NAME = "LiTT Code";
