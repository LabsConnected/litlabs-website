/**
 * Project / workspace records for GitHub-backed development.
 */

export type ProjectStatus =
  | "offline"
  | "starting"
  | "ready"
  | "building"
  | "failed";

export interface Project {
  id: string;
  userId: string;
  githubInstallationId: number;
  repositoryId: number;
  owner: string;
  repository: string;
  defaultBranch: string;
  workingBranch: string;
  workspaceId?: string;
  vercelProjectId?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStatusResponse {
  project: Project | null;
  branch: string;
  lastCommit?: {
    sha: string;
    message: string;
    author: string;
    date: string;
  };
  uncommittedChanges: number;
  pullRequest?: {
    number: number;
    title: string;
    url: string;
    state: "open" | "closed" | "merged";
  };
  checks: {
    name: string;
    status: "queued" | "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";
  }[];
  previewUrl?: string;
  productionUrl?: string;
  syncStatus: "synced" | "syncing" | "behind" | "error";
  workspaceStatus: ProjectStatus;
}

export const PROJECTS_TABLE = "projects";
