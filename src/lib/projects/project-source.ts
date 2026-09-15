/**
 * Canonical Project Source model.
 *
 * Three concepts that this codebase historically collapsed into one:
 *
 *   1. SOURCE OWNERSHIP — who owns the durable files.
 *      "managed" (LiTT owns them) or "github" (mirrored from a repo).
 *
 *   2. VERSION CONTROL — whether the workspace has a Git repository.
 *      Every provisioned LiTT workspace is Git-backed, managed ones
 *      included: prepareManagedWorkspace() runs `git init` and commits
 *      the initial tree.
 *
 *   3. REMOTE PROVIDER — whether a GitHub repository is connected.
 *      Optional, and never required to build.
 *
 * Git is NOT GitHub. A managed project has Git, a branch, history,
 * checkpoints and diffs while having no GitHub repository at all.
 * Code that tested `githubFullName` to decide whether Git tooling was
 * available disabled checkpoints, diff and restore on every managed
 * project, and told the model "this workspace has no repository".
 *
 * Derive every source fact from this module. Do not re-derive it from
 * `githubFullName` at call sites.
 */

import type { CanonicalProject, ProjectSourceType, WorkspaceStatus } from "./types";

/** Who owns the durable source. */
export type ProjectSourceKind = "managed" | "github";

/** Provisioning state of the source, independent of runtime/agent state. */
export type ProjectSourceStatus = "provisioning" | "ready" | "error" | "needs_setup";

/** Default branch for a managed workspace — matches `git init` + initial commit. */
export const DEFAULT_MANAGED_BRANCH = "main";

/**
 * Stored `source_type` values that mean "LiTT owns the source".
 *
 * The database keeps the historical values 'blank' and 'template'
 * rather than being rewritten to 'managed': both already mean
 * LiTT-owned source, and migrating live rows would buy nothing but
 * risk. The domain layer is where they unify.
 */
const MANAGED_SOURCE_TYPES: ReadonlySet<string> = new Set(["blank", "template", "managed", "upload", "imported"]);

/** The view of a project's source that every surface should render from. */
export interface ProjectSourceView {
  /** Who owns the durable files. */
  kind: ProjectSourceKind;
  /** Display label: "LiTT Managed" or "GitHub". */
  label: string;
  /** Provisioning state of the source itself. */
  status: ProjectSourceStatus;
  /** Whether the workspace has a Git repository. Managed projects do. */
  versionControl: "git" | "none";
  /** True when Git history exists for this source. */
  gitInitialized: boolean;
  /** The real working branch, from the workspace when known. */
  branch: string | null;
  /** Whether a GitHub repository is connected. Optional by design. */
  githubConnected: boolean;
  /** "owner/repo" when connected, else null. */
  githubRepository: string | null;
  /** Canonical workspace identity. */
  workspaceId: string | null;
  workspaceStatus: WorkspaceStatus | null;
  /** Whether files can be written through the workspace. */
  writable: boolean;
  /** Provisioning error, when status is "error". */
  error: string | null;
}

/** Whether a stored source_type means LiTT owns the source. */
export function isManagedSourceType(sourceType: ProjectSourceType | string | null): boolean {
  if (!sourceType) return true; // legacy rows with no source_type are managed until proven otherwise
  return MANAGED_SOURCE_TYPES.has(sourceType);
}

/** Resolve source ownership for a project. */
export function resolveSourceKind(project: {
  sourceType: ProjectSourceType | string | null;
  githubFullName: string | null;
}): ProjectSourceKind {
  // A connected GitHub repository makes the project GitHub-backed
  // regardless of how the row was originally created, so a managed
  // project that is later published to GitHub reports truthfully.
  if (project.githubFullName) return "github";
  return isManagedSourceType(project.sourceType) ? "managed" : "github";
}

/**
 * The canonical working branch.
 *
 * The workspace branch is authoritative — it is what `git branch
 * --show-current` reports inside the workspace the terminal, preview
 * and agent all share. GitHub branch fields are a fallback for
 * GitHub-backed projects whose workspace has not been provisioned yet.
 *
 * Managed projects fall back to "main" because prepareManagedWorkspace()
 * always creates that branch. They must never render as "—".
 */
export function resolveBranch(project: {
  workspaceBranch?: string | null;
  githubBranch: string | null;
  githubDefaultBranch: string | null;
  sourceType: ProjectSourceType | string | null;
  githubFullName: string | null;
}): string | null {
  if (project.workspaceBranch) return project.workspaceBranch;
  if (project.githubBranch) return project.githubBranch;
  if (project.githubDefaultBranch) return project.githubDefaultBranch;
  return resolveSourceKind(project) === "managed" ? DEFAULT_MANAGED_BRANCH : null;
}

/** Map workspace provisioning state onto source status. */
function resolveSourceStatus(
  workspaceStatus: WorkspaceStatus | null,
  workspaceId: string | null,
): ProjectSourceStatus {
  switch (workspaceStatus) {
    case "ready":
      return "ready";
    case "provisioning":
    case "preparing":
      return "provisioning";
    case "failed":
    case "error":
      return "error";
    case "not_prepared":
    case "stopped":
    case null:
    case undefined:
    default:
      // A project that has never been provisioned needs setup rather
      // than being reported as broken. Legacy repo-less rows land here
      // and get a "Repair source" action, never silent replacement.
      return workspaceId ? "provisioning" : "needs_setup";
  }
}

/**
 * Build the canonical source view for a project.
 *
 * This is the ONE place that decides what a project's source is. The
 * project card, the runtime API, the agent's runtime context and the
 * tool-applicability rules all read from it.
 */
export function describeProjectSource(project: CanonicalProject): ProjectSourceView {
  const kind = resolveSourceKind(project);
  const status = resolveSourceStatus(project.workspaceStatus, project.workspaceId);
  const ready = status === "ready";

  // Git exists once the workspace has been provisioned: managed
  // workspaces are `git init`-ed at creation, GitHub workspaces are
  // clones. Before provisioning there is no working tree, so no Git.
  const gitInitialized = ready;

  return {
    kind,
    label: kind === "managed" ? "LiTT Managed" : "GitHub",
    status,
    versionControl: gitInitialized ? "git" : "none",
    gitInitialized,
    branch: resolveBranch(project),
    githubConnected: Boolean(project.githubFullName),
    githubRepository: project.githubFullName ?? null,
    workspaceId: project.workspaceId,
    workspaceStatus: project.workspaceStatus,
    writable: ready,
    error: status === "error" ? (project.workspaceError ?? "Source provisioning failed") : null,
  };
}

/**
 * The one-line source summary shown under a project's name.
 *
 * Replaces "No repository · —", which read as "this project is empty"
 * for a perfectly healthy managed project that had files, Git history
 * and a branch. A managed project reads "LiTT Managed · Git · main".
 *
 * Pure and dependency-free so client components can use it directly.
 */
export function formatSourceSummary(source: {
  kind: ProjectSourceKind | null;
  status?: ProjectSourceStatus | null;
  versionControl?: "git" | "none";
  branch?: string | null;
  githubRepository?: string | null;
}): string {
  if (source.status === "provisioning") return "Preparing source…";
  if (source.status === "error") return "Source error";
  if (source.status === "needs_setup") return "Source needs setup";

  const parts: string[] = [];
  parts.push(source.githubRepository ?? (source.kind === "github" ? "GitHub" : "LiTT Managed"));
  if (source.versionControl === "git") parts.push("Git");
  if (source.branch) parts.push(source.branch);
  return parts.join(" · ");
}
