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

import type { RuntimeFreshness } from "@/hooks/useLiTTRuntime";

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
  /** True when terminal WebSocket is connected (client-side transport) */
  terminalConnected: boolean;
  /** True when terminal server is reachable (server-side health check) */
  terminalServerReachable: boolean;

  /** Project identity */
  projectId: string | null;
  projectName: string | null;
  /** Connected GitHub repository ("owner/repo"), or null. OPTIONAL. */
  repository: string | null;
  /** The workspace's real Git branch. Managed projects report "main". */
  branch: string | null;
  /** How the project source was created (raw stored value) */
  sourceType: "github" | "upload" | "template" | "blank" | "managed" | null;

  // ─── Source model (Git != GitHub) ────────────────────────────────
  /** Who owns the durable source: LiTT ("managed") or GitHub. */
  sourceKind: "managed" | "github" | null;
  /** Display label for the source: "LiTT Managed" or "GitHub". */
  sourceLabel: string | null;
  /** Provisioning state of the source itself, separate from the agent. */
  sourceStatus: "provisioning" | "ready" | "error" | "needs_setup" | null;
  /** Whether the workspace has a Git repository. Managed projects do. */
  versionControl: "git" | "none";
  /** Whether a GitHub repository is connected. Optional by design. */
  githubConnected: boolean;

  /** Workspace identity */
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceStatus: string | null;

  /** Terminal identity */
  terminalSessionId: string | null;

  /** Preview state — client-side hook refines this */
  previewState: "idle" | "preparing" | "ready" | "running" | "failed";
  /** Logs state — client-side hook refines this */
  logsState: "idle" | "streaming" | "failed";
  /** Deployment state — from project metadata */
  deploymentState: "none" | "preview" | "production" | "failed";

  // ─── Separated access/permission fields ──────────────────────────
  // These are INDEPENDENT concepts. Do not derive one from another.
  // See the operational-connection model in AGENTS.md / design docs.

  /** Reads work via API even if terminal is down */
  readAccess: boolean;
  /** A write surface exists (workspace provisioned OR terminal connected) */
  writeSurfaceAvailable: boolean;
  /** Policy: writes always require explicit user approval. NOT derived from connection state. */
  writeApprovalRequired: boolean;
  /** Legacy alias — true when a write surface exists. Use writeSurfaceAvailable. */
  writeAccess: boolean;

  // ─── Voice (separate from execution) ─────────────────────────────
  /** Inworld env vars are set (server-side check) */
  voiceConfigured: boolean;
  /** Live voice WebSocket session is active (client-side transport) */
  voiceSessionConnected: boolean;

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
  terminalServerReachable: false,
  projectId: null,
  projectName: null,
  repository: null,
  branch: null,
  sourceType: null,
  sourceKind: null,
  sourceLabel: null,
  sourceStatus: null,
  versionControl: "none",
  githubConnected: false,
  workspaceId: null,
  workspacePath: null,
  workspaceStatus: null,
  terminalSessionId: null,
  previewState: "idle",
  logsState: "idle",
  deploymentState: "none",
  readAccess: false,
  writeSurfaceAvailable: false,
  writeAccess: false,
  writeApprovalRequired: true, // policy — always true
  voiceConfigured: false,
  voiceSessionConnected: false,
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
      // "Terminal idle" — the workspace is ready; only the visible terminal
      // PTY isn't attached. Builds and commands run server-side regardless,
      // so this must never read as an outage.
      return "Terminal idle";
    case "terminal_reconnecting":
      return "Reconnecting terminal…";
    case "error":
      return "Runtime error";
    case "unauthenticated":
      return "Sign in required";
  }
}

/**
 * Human-readable label for the socket's heartbeat freshness.
 * The socket is a STATUS FEED, not the execution pipe — tool execution runs
 * server-side over HTTP, so a stale/down feed never blocks chat or builds.
 * Labels say that explicitly so "UNREACHABLE" never reads as an outage.
 */
export function runtimeFreshnessLabel(freshness: RuntimeFreshness): string {
  switch (freshness) {
    case "fresh":
      return "Live";
    case "stale":
      return "State feed stale — status may be behind";
    case "unreachable":
      return "State feed unreachable — chat works; builds run through the server";
  }
}

/**
 * Pre-send expectation hint for the composer.
 *
 * Returns a hint string only when the live status feed is down but the
 * workspace is ready — the one case where the UI would otherwise show an
 * alarming "UNREACHABLE" with zero warning before a build request.
 * Returns null in every other case (nothing needs saying).
 *
 * The composer stays ENABLED regardless — chat always works; the hint only
 * sets expectations.
 */
export function deriveExecutionHint(
  freshness: RuntimeFreshness,
  runtime: { phase: RuntimePhase; workspaceProvisioned: boolean },
): string | null {
  if (freshness !== "unreachable") return null;
  const workspaceReady =
    runtime.workspaceProvisioned ||
    runtime.phase === "ready" ||
    runtime.phase === "terminal_disconnected";
  if (!workspaceReady) return null;
  return "Live status feed is down — LiTT can still chat and run builds through the server.";
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
