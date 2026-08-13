/**
 * Canonical Runtime Context — the single authoritative source of runtime
 * state for all workspace-aware chat requests.
 *
 * This module merges:
 *   1. Server-side project runtime (from verifyProjectWorkspace + DB)
 *   2. Client-side runtime hints (terminal PTY status, voice, camera)
 *   3. Terminal server health check
 *
 * The LLM must NEVER guess connection state. It reads this context.
 *
 * Key principle: the client-side terminal store is the source of truth
 * for PTY session status. The server can verify the terminal server is
 * alive but cannot know if a specific client has an active PTY session.
 * We trust the client's terminal status hint when it says "connected"
 * and verify the server is alive as a secondary check.
 */

import "server-only";

import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getStudioContext } from "@/lib/capabilities/studio-context";
import type { StudioContext } from "@/lib/capabilities/studio-context";

// ─── Types ────────────────────────────────────────────────────────

export interface CanonicalRuntimeContext {
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  workspaceReady: boolean;
  workspaceRoot: string | null;
  /** Server-side workspace execution is available (verifyProjectWorkspace passed). */
  workspaceExecutionAvailable: boolean;
  terminalConnected: boolean;
  terminalStatus: "connected" | "disconnected" | "connecting" | "error" | "unavailable";
  terminalServerAlive: boolean;
  githubConnected: boolean;
  repository: string | null;
  branch: string | null;
  writePermission: boolean;
  previewStatus: "ready" | "unavailable" | "unknown";
  availableTools: string[];
  executionMode: "plan" | "act" | "auto";
  model: string | null;
  provider: string | null;
  sourceType: "github" | "blank" | "template" | "upload" | null;
}

export interface ClientRuntimeHint {
  terminalStatus?: string;
  terminalSessionId?: string | null;
  terminalCwd?: string | null;
  workspaceStatus?: string;
  voiceTransportConnected?: boolean;
  cameraActive?: boolean;
}

// ─── Builder ──────────────────────────────────────────────────────

/**
 * Build the canonical runtime context for a chat request.
 *
 * This is the ONE function that all workspace-aware chat routes should
 * call to get authoritative runtime state. It merges server-side
 * verification with client-side hints.
 *
 * @param userId - Authenticated user ID
 * @param projectId - Active project ID (may be null for non-project chat)
 * @param clientHint - Optional client-side runtime state
 * @param options - Optional studio context (to avoid duplicate fetches)
 */
export async function buildCanonicalRuntimeContext(
  userId: string,
  projectId: string | null,
  clientHint?: ClientRuntimeHint,
  options?: {
    studioContext?: StudioContext;
    executionMode?: "plan" | "act" | "auto";
    model?: string;
    provider?: string;
  },
): Promise<CanonicalRuntimeContext> {
  // Start with defaults — never guess "ready"
  const ctx: CanonicalRuntimeContext = {
    projectId: null,
    projectName: null,
    workspaceId: null,
    workspaceReady: false,
    workspaceExecutionAvailable: false,
    workspaceRoot: null,
    terminalConnected: false,
    terminalStatus: "disconnected",
    terminalServerAlive: false,
    githubConnected: false,
    repository: null,
    branch: null,
    writePermission: false,
    previewStatus: "unknown",
    availableTools: [],
    executionMode: options?.executionMode ?? "act",
    model: options?.model ?? null,
    provider: options?.provider ?? null,
    sourceType: null,
  };

  if (!projectId || !userId) {
    return ctx;
  }

  ctx.projectId = projectId;

  // Get studio context (may be passed in to avoid duplicate fetch)
  const studioCtx = options?.studioContext ?? await getStudioContext(userId);

  ctx.githubConnected = studioCtx.repositoryConnected;
  ctx.repository = studioCtx.repositoryName ?? null;
  ctx.availableTools = studioCtx.availableTools;

  // Try to verify workspace (server-side authoritative)
  try {
    const verified = await verifyProjectWorkspace(projectId, userId);
    ctx.workspaceId = verified.workspaceId;
    ctx.workspaceRoot = verified.workspaceRoot;
    ctx.workspaceReady = true;
    ctx.workspaceExecutionAvailable = true;
    ctx.projectName = verified.project.name;
    ctx.branch = verified.project.githubBranch ?? verified.project.githubDefaultBranch ?? null;
    ctx.sourceType = verified.project.sourceType ?? null;
    ctx.repository = verified.project.githubFullName ?? null;
    ctx.githubConnected = !!verified.project.githubFullName;
    ctx.writePermission = true;
    ctx.previewStatus = "ready";
  } catch {
    // Workspace not ready — check client hint for terminal-based write surface
    ctx.workspaceReady = false;
  }

  // Terminal status: trust client hint (it knows PTY state)
  // The client-side terminal store is the source of truth for PTY sessions
  if (clientHint?.terminalStatus === "connected" && clientHint.terminalCwd) {
    ctx.terminalConnected = true;
    ctx.terminalStatus = "connected";
    // Terminal provides a write surface even without workspace provisioning
    if (!ctx.writePermission) {
      ctx.writePermission = true;
    }
  } else if (clientHint?.terminalStatus === "connecting") {
    ctx.terminalStatus = "connecting";
    ctx.terminalConnected = false;
  } else if (clientHint?.terminalStatus === "error" || clientHint?.terminalStatus === "auth_failed" || clientHint?.terminalStatus === "pty_failed") {
    ctx.terminalStatus = "error";
    ctx.terminalConnected = false;
  } else {
    ctx.terminalStatus = "disconnected";
    ctx.terminalConnected = false;
  }

  // Terminal server alive check (from studio context)
  ctx.terminalServerAlive = studioCtx.terminalConnected;

  // If terminal server is alive but client says disconnected,
  // the terminal is available but no PTY session is open.
  // This is NOT "terminal not connected" — it's "terminal available, no active session"
  if (ctx.terminalServerAlive && !ctx.terminalConnected && ctx.terminalStatus === "disconnected") {
    // The terminal server is alive — a session can be opened
    // Don't claim "disconnected" as if the terminal is broken
    ctx.terminalStatus = "disconnected"; // truthful: no active PTY session
  }

  return ctx;
}

// ─── LLM Context Block ────────────────────────────────────────────

/**
 * Build a plain-English context block for the LLM system prompt.
 * The LLM must read this block and never guess connection state.
 */
export function buildRuntimeContextBlock(ctx: CanonicalRuntimeContext): string {
  const lines: string[] = [
    "RUNTIME CONTEXT (server-authoritative — do not guess):",
    `- Project: ${ctx.projectName ?? "none"}`,
    `- Project ID: ${ctx.projectId ?? "none"}`,
    `- Workspace: ${ctx.workspaceReady ? "ready" : "not ready"}`,
    `- Workspace execution: ${ctx.workspaceExecutionAvailable ? "available — LiTT can read, write, and execute commands in the workspace" : "not available"}`,
    `- Visible terminal UI: ${ctx.terminalStatus}${ctx.terminalServerAlive ? " (server alive)" : ""}`,
    `- Repository: ${ctx.githubConnected ? ctx.repository ?? "connected" : "not connected"}`,
    `- Branch: ${ctx.branch ?? "none"}`,
    `- Write permission: ${ctx.writePermission ? "allowed" : "not allowed"}`,
    `- Preview: ${ctx.previewStatus}`,
    `- Available tools: ${ctx.availableTools.length > 0 ? ctx.availableTools.join(", ") : "none"}`,
    `- Execution mode: ${ctx.executionMode}`,
  ];

  if (ctx.projectId) {
    lines.push("");
    lines.push(`IMPORTANT: When calling project tools (inspect_project_files, read_file, edit_file, etc.), pass project_id="${ctx.projectId}". Do NOT use the repository name as project_id.`);
  }

  if (ctx.model) {
    lines.push(`- Model: ${ctx.model}`);
  }
  if (ctx.provider) {
    lines.push(`- Provider: ${ctx.provider}`);
  }

  lines.push("");
  lines.push("RULE: Never claim a capability is ready, connected, or running if the runtime context above says otherwise.");

  if (ctx.workspaceExecutionAvailable && !ctx.terminalConnected) {
    lines.push("IMPORTANT: Workspace execution is available even though the visible terminal UI is disconnected. You CAN read files, write files, and run commands. Do NOT say 'terminal is not connected' — say 'I can execute workspace operations' instead.");
  } else if (!ctx.workspaceExecutionAvailable && ctx.terminalConnected) {
    lines.push("IMPORTANT: The visible terminal UI is connected but server-side workspace execution is not verified. You can see terminal output but cannot execute tools safely.");
  } else if (ctx.workspaceExecutionAvailable && ctx.terminalConnected) {
    lines.push("Both workspace execution and visible terminal are available.");
  } else {
    lines.push("No workspace execution or terminal connection is available. You can only chat.");
  }

  if (ctx.executionMode === "act") {
    lines.push("APPROVAL: You are in ACT mode. Mutations (file writes, commands) require explicit user approval. When you need to mutate, tell the user what you want to do and wait for approval.");
  } else if (ctx.executionMode === "auto") {
    lines.push("APPROVAL: You are in AUTO mode. Safe workspace operations (file reads, writes, patches, git commit, builds) are auto-approved. Sensitive actions (force push, delete, rebase) still require approval.");
  } else {
    lines.push("APPROVAL: You are in PLAN mode. No mutations allowed — read-only inspection only.");
  }

  return lines.join("\n");
}
