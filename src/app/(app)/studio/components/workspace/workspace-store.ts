"use client";

import { create } from "zustand";
import {
  inverseWorkspaceAction,
  type WorkspaceAction,
  type WorkspaceDocument,
  emptyWorkspaceDocument,
} from "@/lib/studio/workspace-document";
import type { HttpWorkspaceAction } from "@/lib/studio/workspace-document";

interface WorkspaceState {
  projectId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  document: WorkspaceDocument;
  revision: number;
  selectedIds: string[];
  undo: WorkspaceAction[];
  redo: WorkspaceAction[];
  pendingActions: HttpWorkspaceAction[];
  load: (projectId: string) => Promise<void>;
  select: (ids: string[]) => void;
  enqueueAction: (action: HttpWorkspaceAction) => void;
  shiftAction: () => HttpWorkspaceAction | null;
  commit: (action: HttpWorkspaceAction, inverse: WorkspaceAction | null) => Promise<boolean>;
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

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projectId: null,
  status: "idle",
  error: null,
  document: emptyWorkspaceDocument(),
  revision: 0,
  selectedIds: [],
  undo: [],
  redo: [],
  pendingActions: [],

  async load(projectId) {
    set({ projectId, status: "loading", error: null, selectedIds: [], undo: [], redo: [] });
    try {
      const res = await fetch(`/api/studio/workspaces?projectId=${encodeURIComponent(projectId)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        set({ status: "error", error: body.error || "The workspace could not be loaded." });
        return;
      }
      set({
        status: "ready",
        document: body.document ?? emptyWorkspaceDocument(),
        revision: body.revision ?? 1,
        error: null,
      });
    } catch {
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

  async commit(action, inverse) {
    const { projectId, revision } = get();
    if (!projectId || !revision) return false;
    const result = await postAction(projectId, revision, action);
    if (result.status === 409 && result.body.workspace) {
      set({
        document: result.body.workspace.document,
        revision: result.body.workspace.revision,
        error: "The workspace changed in another session and was reloaded.",
        undo: [],
        redo: [],
      });
      return false;
    }
    if (!result.ok) {
      set({ error: result.body.error || "The workspace change was not saved." });
      return false;
    }
    set((state) => ({
      document: result.body.document,
      revision: result.body.revision,
      error: null,
      undo: inverse ? [...state.undo, inverse].slice(-50) : state.undo,
      redo: [],
    }));
    return true;
  },

  async undoAction() {
    const inverse = get().undo.at(-1);
    if (!inverse) return;
    const redo = inverseWorkspaceAction(get().document, inverse as WorkspaceAction);
    const ok = await get().commit(inverse as HttpWorkspaceAction, null);
    if (!ok) return;
    set((state) => ({ undo: state.undo.slice(0, -1), redo: redo ? [...state.redo, redo] : state.redo }));
  },

  async redoAction() {
    const action = get().redo.at(-1);
    if (!action) return;
    const inverse = inverseWorkspaceAction(get().document, action);
    const ok = await get().commit(action as HttpWorkspaceAction, null);
    if (!ok) return;
    set((state) => ({ redo: state.redo.slice(0, -1), undo: inverse ? [...state.undo, inverse] : state.undo }));
  },
}));
