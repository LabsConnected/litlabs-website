"use client";

import { create } from "zustand";
import {
  inverseWorkspaceAction,
  type Frame,
  type WorkspaceAction,
  type WorkspaceDocument,
  emptyWorkspaceDocument,
} from "@/lib/studio/workspace-document";
import type { HttpWorkspaceAction } from "@/lib/studio/workspace-document";

interface WorkspaceState {
  projectId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  unavailable: boolean;
  error: string | null;
  document: WorkspaceDocument;
  revision: number;
  selectedIds: string[];
  undo: WorkspaceAction[];
  redo: WorkspaceAction[];
  pendingActions: HttpWorkspaceAction[];
  liveFrames: Record<string, Frame>;
  load: (projectId: string) => Promise<void>;
  setLiveFrames: (frames: Record<string, Frame>) => void;
  select: (ids: string[]) => void;
  enqueueAction: (action: HttpWorkspaceAction) => void;
  shiftAction: () => HttpWorkspaceAction | null;
  commit: (action: HttpWorkspaceAction, inverse: WorkspaceAction | null, options?: { preserveRedo?: boolean }) => Promise<boolean>;
  undoAction: () => Promise<void>;
  redoAction: () => Promise<void>;
}

async function postAction(projectId: string, revision: number, action: HttpWorkspaceAction) {
  const res = await fetch("/api/studio/workspaces", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ projectId, revision, action }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/** One save at a time. Overlapping PUTs in a single tab were reading the
    same revision, 409ing against themselves, and then a late response
    could put the client revision back behind the server. */
let commitQueue: Promise<void> = Promise.resolve();
let mutationEpoch = 0;

function enqueueSave(task: () => Promise<void>): Promise<void> {
  const run = commitQueue.then(task, task);
  commitQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function commitWorkspaceAction(
  get: () => WorkspaceState,
  set: (partial: Partial<WorkspaceState> | ((state: WorkspaceState) => Partial<WorkspaceState>)) => void,
  action: HttpWorkspaceAction,
  inverse: WorkspaceAction | null,
  options?: { preserveRedo?: boolean },
): Promise<boolean> {
  mutationEpoch += 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { projectId, revision } = get();
    if (!projectId || !revision) return false;
    const result = await postAction(projectId, revision, action);
    const server = result.body.workspace as { document?: WorkspaceDocument; revision?: number } | null | undefined;
    if (result.status === 409 && server?.document && typeof server.revision === "number") {
      set({ document: server.document, revision: server.revision, error: null });
      continue;
    }
    if (!result.ok) {
      set({ error: result.body.error || "The workspace change was not saved." });
      return false;
    }
    if (typeof result.body.revision === "number" && result.body.revision < get().revision) return true;
    set((state) => ({
      document: result.body.document,
      revision: result.body.revision,
      error: null,
      undo: inverse ? [...state.undo, inverse].slice(-50) : state.undo,
      redo: options?.preserveRedo ? state.redo : [],
    }));
    return true;
  }
  set({ error: "The workspace changed in another session and was reloaded." });
  return false;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projectId: null,
  status: "idle",
  unavailable: false,
  error: null,
  document: emptyWorkspaceDocument(),
  revision: 0,
  selectedIds: [],
  undo: [],
  redo: [],
  pendingActions: [],
  liveFrames: {},

  setLiveFrames(frames) {
    set({ liveFrames: frames });
  },

  async load(projectId) {
    const epoch = mutationEpoch;
    set({ projectId, status: "loading", unavailable: false, error: null, selectedIds: [], undo: [], redo: [], liveFrames: {} });
    try {
      const res = await fetch(`/api/studio/workspaces?projectId=${encodeURIComponent(projectId)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (epoch !== mutationEpoch) return;
      if (!res.ok) {
        set({
          status: "error",
          unavailable: res.status === 503,
          error: body.error || (res.status === 503
            ? "The workspace table is not available yet. Apply the studio_workspaces migration, then reload."
            : "The workspace could not be loaded."),
        });
        return;
      }
      set({
        status: "ready",
        unavailable: false,
        document: body.document ?? emptyWorkspaceDocument(),
        revision: body.revision ?? 1,
        error: null,
      });
    } catch {
      if (epoch !== mutationEpoch) return;
      set({ status: "error", error: "The workspace could not be loaded." });
    }
  },

  select(ids) {
    set({ selectedIds: ids });
  },

  enqueueAction(action) {
    set((state) => ({ pendingActions: [...state.pendingActions, action] }));
  },

  shiftAction() {
    const [next, ...rest] = get().pendingActions;
    if (!next) return null;
    set({ pendingActions: rest });
    return next;
  },

  async commit(action, inverse, options) {
    let ok = false;
    await enqueueSave(async () => {
      ok = await commitWorkspaceAction(get, set, action, inverse, options);
    });
    return ok;
  },

  async undoAction() {
    await enqueueSave(async () => {
      const inverse = get().undo.at(-1);
      if (!inverse) return;
      const redo = inverseWorkspaceAction(get().document, inverse as WorkspaceAction);
      const ok = await commitWorkspaceAction(get, set, inverse as HttpWorkspaceAction, null, { preserveRedo: true });
      if (!ok) return;
      set((state) => ({ undo: state.undo.slice(0, -1), redo: redo ? [...state.redo, redo] : state.redo }));
    });
  },

  async redoAction() {
    await enqueueSave(async () => {
      const action = get().redo.at(-1);
      if (!action) return;
      const inverse = inverseWorkspaceAction(get().document, action);
      const ok = await commitWorkspaceAction(get, set, action as HttpWorkspaceAction, null, { preserveRedo: true });
      if (!ok) return;
      set((state) => ({ redo: state.redo.slice(0, -1), undo: inverse ? [...state.undo, inverse] : state.undo }));
    });
  },
}));
