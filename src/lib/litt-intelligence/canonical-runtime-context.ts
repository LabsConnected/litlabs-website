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
import { capabilityNotice, type WorkspaceShape } from "@/lib/studio/workspace-capability";
import type { DeploymentStatus } from "@/lib/deployments/user-deployment";
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
  /** Workspace capability shape — drives not-applicable classification. */
  workspaceShape?: WorkspaceShape | null;
  /**
   * Deployment state — INDEPENDENT of previewStatus. A ready preview is a dev
   * process answering behind auth; a ready deployment is a public URL anyone
   * can open. Neither implies the other.
   */
  deploymentStatus: DeploymentStatus;
  /** The verified public URL, set only when deploymentStatus is "ready". */
  deploymentUrl: string | null;
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
    workspaceShape: null,
    deploymentStatus: "not_started",
    deploymentUrl: null,
  };

  if (!projectId || !userId) {
    return ctx;
  }

  ctx.projectId = projectId;

  // Get studio context (may be passed in to avoid duplicate fetch).
  // Pass projectId so getStudioContext resolves the canonical project
  // (studio_projects first, then legacy) instead of only querying the
  // legacy projects table. This fixes the divergence where LiTT said
  // "repository not connected" for projects the Studio UI showed as
  // connected.
  const studioCtx = options?.studioContext ?? await getStudioContext(userId, projectId);

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
    // Preview readiness is a SEPARATE fact from workspace readiness. It was
    // previously set to "ready" here, so a verified workspace silently
    // implied a running preview. Preview state comes from the project's
    // runtime status, and stays "unknown" when nothing has reported it.
    ctx.previewStatus = verified.project.runtimeStatus === "ready" && verified.project.previewUrl
      ? "ready"
      : verified.project.runtimeStatus === "failed" || verified.project.runtimeError
        ? "unavailable"
        : "unknown";
    // Record workspace shape so repo-only checks can be classified N/A.
    ctx.workspaceShape = {
      framework: verified.project.framework,
      packageManager: verified.project.packageManager,
      githubFullName: verified.project.githubFullName,
      sourceType: verified.project.sourceType ?? null,
    };
  } catch {
    // Workspace not ready — check client hint for terminal-based write surface
    ctx.workspaceReady = false;
  }

  // Deployment state — read independently of preview. Any failure here
  // leaves it at "not_started": the context never guesses that something was
  // published.
  try {
    const { findLatestDeploymentForProject } = await import("@/lib/deployments/deployment-store");
    const latest = await findLatestDeploymentForProject(projectId, userId);
    if (latest) {
      ctx.deploymentStatus = latest.status;
      // A URL is reported only for a ready, verified deployment.
      ctx.deploymentUrl = latest.status === "ready" && latest.urlVerified ? latest.publicUrl : null;
    }
  } catch {
    // Storage unavailable (or the table not yet migrated) — stay at
    // "not_started" rather than implying a deployment exists.
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
    `- Deployment: ${ctx.deploymentStatus}`,
    `- Live URL: ${ctx.deploymentUrl ?? "none"}`,
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
  if (ctx.deploymentStatus !== "ready") {
    lines.push(
      "IMPORTANT: A preview is NOT a deployment. Nothing has been deployed and there is no live URL. "
      + "The preview runs behind this app's login; only a deployment produces a public address. "
      + "To publish, call project.deploy and report the URL it returns — never present a preview link as a live site.",
    );
  } else {
    lines.push(`The project is deployed and its verified public URL is ${ctx.deploymentUrl ?? "unknown"}.`);
  }
  lines.push("RULE: These states are INDEPENDENT. A ready preview does not mean the terminal is connected, the repository is healthy, the build succeeded, or anything was deployed. Report each state on its own evidence.");
  lines.push("RULE: Never report work as complete without evidence. A build is complete only after a mutating tool call returned a successful result; a deployment is complete only after it succeeded and its live URL was verified. Acknowledging a request is not completing it.");

  // Static / repo-less workspaces: absent tooling is the workspace type, not
  // a defect. Without this the model reports "tsc is broken", "ESLint config
  // missing", "git is not installed" and proposes installs for a workspace
  // that intentionally has none.
  const notice = ctx.workspaceShape ? capabilityNotice(ctx.workspaceShape) : null;
  if (notice) {
    lines.push(notice);
  } else if (!ctx.githubConnected) {
    lines.push("WORKSPACE TYPE: no repository is connected, so git tooling (status, diff, log, commit, push, pull requests) is NOT APPLICABLE — not broken. Do not report it as a failure and do not propose installing Git.");
  }

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
