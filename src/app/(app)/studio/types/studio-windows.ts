/**
 * Studio window-compositor types.
 *
 * StudioWindow records bind to the durable server task model
 * (`StudioTask` in `@/lib/studio/task-types`, served by /api/studio/tasks)
 * via `taskId`. Runtime/session resources live on the server task —
 * closing a window never destroys the task, its conversation, or its run.
 */

export type StudioWindowType =
  | "chat"
  | "preview"
  | "files"
  | "terminal"
  | "inspector"
  | "activity"
  | "browser"
  | "media"
  | "plan"
  | "code"
  | "canvas";

export type StudioWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StudioWindowDock = "left" | "right" | "top" | "bottom" | null;

export type StudioWindowFlags = {
  minimized: boolean;
  maximized: boolean;
  docked: StudioWindowDock;
  hidden?: boolean;
};

export type StudioWindow = {
  id: string;
  /** Durable task identity — every window action resolves through this. */
  taskId: string;
  /** Project that owns the canvas this window lives on. */
  projectId: string;
  type: StudioWindowType;
  title: string;
  bounds: StudioWindowBounds;
  zIndex: number;
  state: StudioWindowFlags;
  /** Tool-specific view state: chat draft, preview route/device, files
      expansion, terminal session id, inspector tab, … */
  viewState: Record<string, unknown>;
  /** Bounds captured before maximize/dock so restore lands exactly. */
  restoreBounds?: StudioWindowBounds;
  createdAt: string;
  updatedAt: string;
};

/** A saved arrangement of windows. Project-level = default shell;
    taskId-scoped = per-task override. */
export type StudioLayout = {
  id: string;
  projectId: string;
  taskId?: string | null;
  name?: string;
  version: 1;
  windows: StudioWindow[];
  updatedAt: string;
};

export type StudioLayoutScope = {
  projectId: string;
  taskId?: string | null;
};
