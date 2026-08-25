/**
 * Station Control — Project Session
 *
 * ProjectSession is the single context that follows LiTT everywhere.
 * It is stored in a Zustand store and accessible from any station.
 */

import type { StationId, PermissionSet, MissionMode, ExecutionPhase } from "./types";

export type PendingApproval = {
  actionId: string;
  reason: string;
  pausedRunId?: string;
  inputs?: Record<string, unknown>;
};

export interface ProjectSession {
  // Identity
  userId: string;
  projectId: string | null;
  conversationId: string | null;

  // Repository
  repository: string | null;
  branch: string | null;

  // Workspace
  workspace: {
    station: StationId;
    activeFile: string | null;
    activeAssetId: string | null;
    selectedCanvasNode: string | null;
  };

  // Mission
  mission: {
    mode: MissionMode;
    currentGoal: string | null;
    plan: { id: string; title: string; status: string; description?: string; priority?: number }[];
    currentTaskId: string | null;
  };

  // Creator state
  creator: {
    activeCreator: "image" | "video" | "music" | "audio" | "design" | "game" | "environment" | null;
    prompt: string | null;
    negativePrompt: string | null;
    style: string | null;
    aspectRatio: string | null;
    referenceAssetId: string | null;
    lastResults: { id: string; url: string }[];
  };

  // Sessions
  browserSession:
    | {
        url: string;
        tabs: { id: string; url: string }[];
      }
    | null;
  terminalSessions: { id: string; command: string; status: "running" | "done" }[];
  preview: { url: string; status: "launching" | "ready" | "error" } | null;

  // Memory
  memory: { key: string; value: string; namespace: string }[];

  // Permissions
  permissions: PermissionSet;

  // Approvals
  pendingApprovals: PendingApproval[];

  // Generated assets (this conversation)
  generatedAssets: { id: string; type: string; url: string; prompt: string }[];
}

export interface ProjectSessionStore {
  session: ProjectSession | null;
  // Updates
  updateWorkspace: (partial: Partial<ProjectSession["workspace"]>) => void;
  updateCreator: (partial: Partial<ProjectSession["creator"]>) => void;
  updateMission: (partial: Partial<ProjectSession["mission"]>) => void;
  setPermissions: (permissions: PermissionSet) => void;
  addPendingApproval: (approval: PendingApproval) => void;
  resolveApproval: (actionId: string, decision: "approved" | "rejected") => void;
  clearSession: () => void;
}

// Initial session state
export const initialSession: ProjectSession = {
  userId: "",
  projectId: null,
  conversationId: null,
  repository: null,
  branch: null,
  workspace: {
    station: "plan",
    activeFile: null,
    activeAssetId: null,
    selectedCanvasNode: null,
  },
  mission: {
    mode: "plan",
    currentGoal: null,
    plan: [],
    currentTaskId: null,
  },
  creator: {
    activeCreator: null,
    prompt: null,
    negativePrompt: null,
    style: null,
    aspectRatio: null,
    referenceAssetId: null,
    lastResults: [],
  },
  browserSession: null,
  terminalSessions: [],
  preview: null,
  memory: [],
  permissions: {
    files: "allow",
    terminal: "allow",
    browser: "allow",
    git: "allow",
    create: "allow",
    preview: "allow",
    deploy: "ask",
    production: "ask",
    payments: "ask",
    externalPost: "ask",
    secrets: "deny",
  },
  pendingApprovals: [],
  generatedAssets: [],
};