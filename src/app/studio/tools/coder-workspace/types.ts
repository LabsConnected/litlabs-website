/**
 * Shared types for the CoderWorkspace shell.
 * These match existing API response shapes — they are local to the coder
 * workspace and not canonical project types (those live in @/lib/projects/types).
 */

export interface StudioProject {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
  framework: string | null;
  workspaceStatus: string;
  runtimeStatus: string;
  previewUrl: string | null;
  workspaceId: string | null;
  workspaceRoot: string | null;
}

export interface ProjectListResponse {
  projects?: StudioProject[];
  legacyOnly?: StudioProject[];
  error?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

export interface CanvasSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  updatedAt: string;
}

export interface CheckpointSummary {
  id: string;
  label: string;
  createdAt: string;
}

export type LoadStatus = "idle" | "loading" | "ready" | "error";
