/**
 * Canonical LiTT Agent Core types.
 *
 * These are the platform-independent contracts that all LiTT surfaces
 * (PowerShell cockpit, web Studio, voice, CLI, Termux) must use.
 *
 * Shapes are derived from existing runtime code:
 * - ToolResult ← src/lib/vapi-tools.ts (success, message, data)
 * - ToolDefinition ← src/lib/litt-intelligence/llm-tool-calling.ts
 * - ExecuteCommandResult ← src/lib/command-executor.ts
 * - RuntimePhase ← src/lib/projects/runtime-state.ts
 *
 * No imports from @/lib, Next.js, React, Clerk, or Supabase.
 */

// ─── Shell ────────────────────────────────────────────────────────

/**
 * Stream chunk emitted during command execution.
 * Both stdout and stderr are streamed incrementally so the CLI cockpit
 * and Studio can show real-time output without waiting for completion.
 */
export interface StreamChunk {
  /** "stdout" or "stderr" */
  stream: "stdout" | "stderr";
  /** Text content (already decoded, secrets redacted by executor) */
  text: string;
  /** Timestamp (ms since epoch) when this chunk was received */
  ts: number;
}

export interface ShellResult {
  ok: boolean;
  /** Discrete status (canonical — matches ToolStatus semantics) */
  status: "success" | "failed" | "cancelled" | "timeout";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  command: string;
  args: string[];
  truncated: boolean;
  error?: string;
  /** Process ID of the spawned child (for debugging orphan processes) */
  pid: number | null;
}

export interface ShellExecuteOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  /** Optional streaming callback — invoked for each stdout/stderr chunk */
  onStream?: (chunk: StreamChunk) => void;
}

// ─── Tools ────────────────────────────────────────────────────────

/**
 * Canonical tool execution status.
 *
 * Four discrete outcomes — not a boolean:
 *   success:   completed normally (exit 0 or equivalent)
 *   failed:    completed abnormally (non-zero exit, error, or rejection)
 *   cancelled: aborted by user or runtime before completion
 *   timeout:   exceeded the configured time limit
 *
 * `success` and `failed` are natural completions.
 * `cancelled` and `timeout` are unnatural completions (the process did not
 * finish on its own — it was killed).
 */
export type ToolStatus = "success" | "failed" | "cancelled" | "timeout";

/**
 * Canonical tool result shape.
 * Derived from src/lib/vapi-tools.ts ToolResult.
 *
 * `success` is retained for backward compatibility but is derived:
 *   success = (status === "success")
 *
 * New code should check `status` instead of `success`.
 */
export interface ToolResult {
  /** Discrete execution status (canonical) */
  status: ToolStatus;
  /** Backward-compatible boolean: true iff status === "success" */
  success: boolean;
  message: string;
  data: Record<string, unknown>;
}

/**
 * Canonical tool definition.
 * Derived from src/lib/litt-intelligence/llm-tool-calling.ts ToolDefinition.
 */
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface ToolCallRequest {
  toolCallId: string;
  toolId: string;
  inputs: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  toolId: string;
  result: unknown;
  success: boolean;
  error?: string;
  durationMs?: number;
}

export type ToolHandler = (
  ctx: ToolContext,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export interface ToolContext {
  cwd: string;
  projectId: string | null;
  userId: string | null;
  shell: ShellExecutor;
}

export interface ToolMetadata {
  projectScoped: boolean;
  mutating: boolean;
  readOnly: boolean;
  /**
   * Optional credential requirements (SEC-5).
   * If provided, the ExecutionGateway resolves credential leases
   * before dispatching the tool. Each entry specifies a provider
   * and the scopes needed.
   * A tool with requiresCredentials cannot execute without valid leases.
   */
  requiresCredentials?: Array<{
    provider: string;
    scopes: string[];
    audience: string | null;
  }>;
}

export interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
  metadata: ToolMetadata;
}

// ─── Shell Executor ───────────────────────────────────────────────

export interface ShellExecutor {
  execute(options: ShellExecuteOptions): Promise<ShellResult>;
  /**
   * Cancel the currently running command.
   * Kills the entire process tree (not just the direct child) to
   * guarantee zero orphan processes.
   * Returns the list of PIDs that were killed (for audit/debugging).
   */
  cancel(): Promise<number[]>;
  readonly cwd: string;
  readonly platform: NodeJS.Platform | string;
  readonly environment: Record<string, string>;
}

// ─── Project Context ──────────────────────────────────────────────

export interface ProjectContext {
  root: string;
  name: string;
  isGitRepo: boolean;
  branch: string | null;
  remote: string | null;
}

// ─── Runtime State ────────────────────────────────────────────────

/**
 * Canonical runtime phases.
 * Derived from src/lib/projects/runtime-state.ts RuntimePhase
 * and src/lib/litt-intelligence/types.ts ActionPhase.
 */
export type RuntimePhase =
  | "idle"
  | "thinking"
  | "planning"
  | "editing"
  | "running"
  | "testing"
  | "browsing"
  | "verifying"
  | "waiting_approval"
  | "complete"
  | "failed";

/**
 * Heartbeat status — shared between PowerShell, terminal-server, and litbit-web.
 * Both surfaces must see the same heartbeat truth.
 */
export interface HeartbeatStatus {
  /** Monotonic counter, increments on each heartbeat tick */
  seq: number;
  /** Timestamp (ms since epoch) of the last successful heartbeat */
  lastHeartbeatAt: number;
  /** Consecutive failures since last success */
  failures: number;
  /** Threshold after which the runtime is considered stale/offline */
  maxFailures: number;
  /** Interval between heartbeats in ms */
  intervalMs: number;
  /** Measured latency of the last heartbeat in ms, or null if not yet measured */
  latencyMs: number | null;
}

/**
 * Active command being executed (or null when idle).
 * Both surfaces need this to show "running typecheck..." etc.
 */
export interface ActiveCommand {
  command: string;
  args: string[];
  startedAt: number;
  cwd: string;
  /** Unique run identifier — same across CLI, Studio, and Socket.IO clients */
  runId: string;
}

/**
 * Result of the last completed command.
 * Both surfaces need this to show success/error state.
 */
export interface LastResult {
  command: string;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  finishedAt: number;
  message: string;
  /** Run identifier — matches the runId from ActiveCommand when the command started */
  runId: string;
}

export interface RuntimeState {
  phase: RuntimePhase;
  project: ProjectContext | null;
  branch: string | null;
  model: string | null;
  profile: string | null;
  gitChanges: number;
  online: boolean;
  pingMs: number;
  contextTokens: number;
  // Phase 2C additions — shared truth for both surfaces
  heartbeat: HeartbeatStatus;
  activeCommand: ActiveCommand | null;
  lastResult: LastResult | null;
  /** Timestamp of the last state mutation (ms since epoch) */
  updatedAt: number;
}

// ─── Runtime Events ───────────────────────────────────────────────

/**
 * Canonical runtime event types.
 *
 * `litt_event` is the unified broadcast type — all surfaces (CLI cockpit,
 * Studio, Socket.IO) listen for this and dispatch on the `subtype` field.
 * Individual event types (phase_change, tool_call, etc.) are also emitted
 * directly for surfaces that want to handle them individually.
 */
export type RuntimeEventType =
  | "phase_change"
  | "tool_call"
  | "tool_result"
  | "tool_stream"
  | "delta"
  | "error"
  | "status"
  | "heartbeat"
  | "command_start"
  | "command_end"
  | "state_sync"
  | "litt_event";

export interface RuntimeEvent {
  type: RuntimeEventType;
  ts: number;
  data: Record<string, unknown>;
  /** For litt_event: the specific event subtype being broadcast */
  subtype?: string;
  /** Canonical run ID — present on all events belonging to a specific run */
  runId?: string;
  /** Canonical tool call ID — present on tool_call, tool_result, tool_stream */
  toolCallId?: string;
}

export type RuntimeEventEmitter = (event: RuntimeEvent) => void;

// ─── Model Provider ───────────────────────────────────────────────

export type ModelProfile = "fast" | "smart" | "long" | "auto";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelProvider {
  stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult>;
  health(): Promise<number>;
}

export type ModelStreamEvent =
  | { type: "meta"; provider: string; model: string; profile: ModelProfile }
  | { type: "delta"; text: string }
  | { type: "done"; model: string; usage: { total_tokens: number }; timing: { ttftMs: number; generationMs: number; totalMs: number } }
  | { type: "error"; message: string };

export interface ModelResult {
  content: string;
  model: string;
  provider: string;
  usage: { total_tokens: number };
  timing: { ttftMs: number; generationMs: number; totalMs: number };
  profile: ModelProfile;
}

// ─── Memory Adapter ───────────────────────────────────────────────

export interface MemoryAdapter {
  save(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  search(query: string): Promise<MemoryEntry[]>;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  score: number;
}

// ─── Approval Provider ────────────────────────────────────────────

export type ApprovalLevel = "allow" | "ask" | "deny";

export interface ApprovalRequest {
  toolId: string;
  description: string;
  args: Record<string, unknown>;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

export interface ApprovalProvider {
  request(req: ApprovalRequest): Promise<ApprovalResult>;
  level(toolId: string): ApprovalLevel;
}

// ─── Auth Provider ────────────────────────────────────────────────

export interface AuthProvider {
  getUserId(): string | null;
  isAuthenticated(): boolean;
}
