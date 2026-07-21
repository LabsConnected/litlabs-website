export type OpenEditorFile = {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  version: string;
  dirty: boolean;
};

export type EditorWorkspaceState = {
  files: Record<string, OpenEditorFile>;
  openTabs: string[];
  activePath: string | null;
  loadingPath: string | null;
  savingPaths: Set<string>;
};

export type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  children?: WorkspaceTreeNode[];
};

export type WorkspaceFile = {
  path: string;
  content: string;
  version: string;
  size: number;
};

export type SearchResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type GitStatusResult = {
  branch: string;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: string }>;
  modified: Array<{ path: string; status: string }>;
  untracked: string[];
  clean: boolean;
};

export type CodeChangeProposal = {
  id: string;
  workspaceId: string;
  agentId: "litt" | "spark";
  title: string;
  explanation: string;
  files: Array<{
    path: string;
    operation: "create" | "edit" | "delete";
    before: string | null;
    after: string | null;
  }>;
  status: "proposed" | "approved" | "applying" | "applied" | "rejected" | "failed";
};
