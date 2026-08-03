// Canonical block types for the Builder stream.
// Everything LiTT produces is appended/updated as a block inside the single
// Builder workspace instead of opening separate tool pages.

export interface BuilderBaseBlock {
  id: string;
  timestamp?: number;
}

export interface ChatMessageBlock extends BuilderBaseBlock {
  type: "message";
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: number;
}

export interface ThinkingBlock extends BuilderBaseBlock {
  type: "thinking";
  content?: string;
}

export interface ErrorBlock extends BuilderBaseBlock {
  type: "error";
  content: string;
}

export interface PlanBlock extends BuilderBaseBlock {
  type: "plan";
  title: string;
  steps: string[];
  activeStep?: number;
}

export interface ProgressBlock extends BuilderBaseBlock {
  type: "progress";
  title: string;
  percent: number;
  message?: string;
}

export interface CodeBlock extends BuilderBaseBlock {
  type: "code";
  file: string;
  language?: string;
  content: string;
  changes?: { added: number; removed: number };
}

export interface DiffBlock extends BuilderBaseBlock {
  type: "diff";
  file: string;
  patch: string;
}

export interface PreviewBlock extends BuilderBaseBlock {
  type: "preview";
  url: string;
  title?: string;
}

export interface TerminalBlock extends BuilderBaseBlock {
  type: "terminal";
  sessionId?: string;
  command: string;
  output?: string;
  status: "queued" | "running" | "success" | "failed" | "disconnected";
  exitCode?: number;
  durationMs?: number;
  startedBy: "user" | "litt";
}

export interface ImageBlock extends BuilderBaseBlock {
  type: "image";
  url: string;
  alt?: string;
  prompt?: string;
}

export interface VideoBlock extends BuilderBaseBlock {
  type: "video";
  url: string;
  title?: string;
}

export interface AudioBlock extends BuilderBaseBlock {
  type: "audio";
  url: string;
  title?: string;
}

export interface AgentRunBlock extends BuilderBaseBlock {
  type: "agent-run";
  agent: string;
  task: string;
  status: "running" | "complete" | "error";
  logs?: string[];
  result?: string;
}

export interface FileBlock extends BuilderBaseBlock {
  type: "file";
  name: string;
  url?: string;
  size?: number;
}

export interface ApprovalBlock extends BuilderBaseBlock {
  type: "approval";
  title: string;
  description: string;
  approved?: boolean;
}

export type BuilderBlock =
  | ChatMessageBlock
  | ThinkingBlock
  | ErrorBlock
  | PlanBlock
  | ProgressBlock
  | CodeBlock
  | DiffBlock
  | PreviewBlock
  | TerminalBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | AgentRunBlock
  | FileBlock
  | ApprovalBlock;

export type TerminalBuilderBlock = TerminalBlock;

// ── Factory helpers ──────────────────────────────────────────────

export function createChatMessageBlock(
  role: ChatMessageBlock["role"],
  content: string,
  createdAt?: number,
  id?: string,
): ChatMessageBlock {
  return {
    type: "message",
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    createdAt: createdAt ?? Date.now(),
    timestamp: typeof createdAt === "number" ? createdAt : Date.now(),
  };
}

export function createThinkingBlock(
  content = "LiTT is working",
  id = "thinking",
): ThinkingBlock {
  return { type: "thinking", id, content };
}

export function createTerminalBlock(
  command: string,
  startedBy: TerminalBlock["startedBy"] = "user",
  id?: string,
): TerminalBlock {
  return {
    type: "terminal",
    id: id ?? `term-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    command,
    status: "queued",
    startedBy,
    timestamp: Date.now(),
  };
}

export function updateTerminalBlock(
  block: TerminalBlock,
  patch: Partial<Omit<TerminalBlock, "id" | "type">>,
): TerminalBlock {
  return { ...block, ...patch };
}
