/**
 * Project Store — Active project state for the Studio.
 *
 * Tracks the current project, its files, and active agents.
 * In a full implementation, this would sync with the server-side
 * project context and update via WebSocket.
 */

import { create } from "zustand";

export interface ProjectFile {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: ProjectFile[];
}

export interface ProjectAgent {
  id: string;
  name: string;
  status: "online" | "idle" | "running" | "error";
}

interface ProjectState {
  projectId: string | null;
  projectName: string | null;
  files: ProjectFile[];
  agents: ProjectAgent[];
  repositoryConnected: boolean;
  activeBranch: string | null;
  setProject: (project: {
    id: string;
    name: string;
    files?: ProjectFile[];
    agents?: ProjectAgent[];
    repositoryConnected?: boolean;
    activeBranch?: string | null;
  }) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: null,
  projectName: null,
  files: [],
  agents: [],
  repositoryConnected: false,
  activeBranch: null,
  setProject: (project) =>
    set({
      projectId: project.id,
      projectName: project.name,
      files: project.files ?? [],
      agents: project.agents ?? [],
      repositoryConnected: project.repositoryConnected ?? false,
      activeBranch: project.activeBranch ?? null,
    }),
  clearProject: () =>
    set({
      projectId: null,
      projectName: null,
      files: [],
      agents: [],
      repositoryConnected: false,
      activeBranch: null,
    }),
}));
