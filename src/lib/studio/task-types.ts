export const TASK_TYPES = [
  "general",
  "build",
  "browser",
  "research",
  "design",
  "image",
  "deploy",
  "debug",
] as const;
export type StudioTaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  "working",
  "ready",
  "waiting_approval",
  "needs_verification",
  "failed",
  "complete",
  "closed",
] as const;
export type StudioTaskStatus = (typeof TASK_STATUSES)[number];

export interface StudioTask {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  taskType: StudioTaskType;
  status: StudioTaskStatus;
  conversationId: string | null;
  activeActionRunId: string | null;
  latestActionRunId: string | null;
  browserSessionId: string | null;
  previewWorkspaceId: string | null;
  previewUrl: string | null;
  selectedArtifact: Record<string, unknown> | null;
  verificationState: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lastOpenedSurface: string | null;
  lastOpenedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudioTaskInput {
  projectId: string;
  title?: string;
  taskType?: StudioTaskType;
  conversationId?: string | null;
}

export interface UpdateStudioTaskInput {
  title?: string;
  status?: StudioTaskStatus;
  conversationId?: string | null;
  activeActionRunId?: string | null;
  latestActionRunId?: string | null;
  browserSessionId?: string | null;
  previewWorkspaceId?: string | null;
  previewUrl?: string | null;
  selectedArtifact?: Record<string, unknown> | null;
  verificationState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  lastOpenedSurface?: string | null;
  lastOpenedAt?: string | null;
  close?: boolean;
  reopen?: boolean;
}
