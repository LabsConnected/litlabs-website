export type WorkspaceMode = "code" | "media" | "command";
export type BottomTab = "terminal" | "problems" | "output";

export type WorkspaceFile = {
  path: string;
  name: string;
  language: string;
  status?: "modified" | "added" | "clean";
  content: string;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  status: "online" | "working" | "busy" | "idle";
  progress: number;
  accent: string;
};
