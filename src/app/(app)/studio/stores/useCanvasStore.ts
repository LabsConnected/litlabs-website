"use client";

import { create } from "zustand";
import type { Canvas, CanvasBlock, ArtifactAction } from "@/lib/canvas/types";

interface CanvasStore {
  // ─── State ───────────────────────────────────────────────────
  canvases: Canvas[];
  activeCanvasId: string | null;
  blocks: Record<string, CanvasBlock[]>; // canvasId → blocks
  loading: boolean;
  error: string | null;

  // ─── Actions ─────────────────────────────────────────────────
  setCanvases: (canvases: Canvas[]) => void;
  setActiveCanvas: (canvasId: string | null) => void;
  setBlocks: (canvasId: string, blocks: CanvasBlock[]) => void;
  upsertCanvas: (canvas: Canvas) => void;
  removeCanvas: (canvasId: string) => void;
  appendBlocks: (canvasId: string, blocks: CanvasBlock[]) => void;
  updateBlock: (canvasId: string, blockId: string, patch: Partial<CanvasBlock>) => void;
  removeBlock: (canvasId: string, blockId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // ─── Derived helpers ─────────────────────────────────────────
  getActiveCanvas: () => Canvas | null;
  getActiveBlocks: () => CanvasBlock[];
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  canvases: [],
  activeCanvasId: null,
  blocks: {},
  loading: false,
  error: null,

  setCanvases: (canvases) => set({ canvases }),

  setActiveCanvas: (canvasId) => {
    set({ activeCanvasId: canvasId });
    // Persist to localStorage so ChatTool can read it for action detection
    if (typeof window !== "undefined") {
      if (canvasId) {
        localStorage.setItem("litt:canvas:active-id", canvasId);
      } else {
        localStorage.removeItem("litt:canvas:active-id");
      }
    }
  },

  setBlocks: (canvasId, blocks) =>
    set((state) => ({ blocks: { ...state.blocks, [canvasId]: blocks } })),

  upsertCanvas: (canvas) =>
    set((state) => {
      const existing = state.canvases.findIndex((c) => c.id === canvas.id);
      if (existing >= 0) {
        const newCanvases = [...state.canvases];
        newCanvases[existing] = canvas;
        return { canvases: newCanvases };
      }
      return { canvases: [canvas, ...state.canvases] };
    }),

  removeCanvas: (canvasId) =>
    set((state) => ({
      canvases: state.canvases.filter((c) => c.id !== canvasId),
      blocks: Object.fromEntries(
        Object.entries(state.blocks).filter(([id]) => id !== canvasId),
      ),
      activeCanvasId: state.activeCanvasId === canvasId ? null : state.activeCanvasId,
    })),

  appendBlocks: (canvasId, newBlocks) =>
    set((state) => ({
      blocks: {
        ...state.blocks,
        [canvasId]: [...(state.blocks[canvasId] ?? []), ...newBlocks],
      },
    })),

  updateBlock: (canvasId, blockId, patch) =>
    set((state) => {
      const blocks = state.blocks[canvasId] ?? [];
      return {
        blocks: {
          ...state.blocks,
          [canvasId]: blocks.map((b) =>
            b.id === blockId ? { ...b, ...patch } : b,
          ),
        },
      };
    }),

  removeBlock: (canvasId, blockId) =>
    set((state) => {
      const blocks = state.blocks[canvasId] ?? [];
      return {
        blocks: {
          ...state.blocks,
          [canvasId]: blocks.filter((b) => b.id !== blockId),
        },
      };
    }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  getActiveCanvas: () => {
    const { canvases, activeCanvasId } = get();
    return canvases.find((c) => c.id === activeCanvasId) ?? null;
  },

  getActiveBlocks: () => {
    const { blocks, activeCanvasId } = get();
    if (!activeCanvasId) return [];
    return blocks[activeCanvasId] ?? [];
  },
}));

/**
 * Execute an ArtifactAction against the Canvas API.
 * Returns the result of the API call.
 */
export async function executeAction(
  action: ArtifactAction,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    switch (action.type) {
      case "canvas.create": {
        const res = await fetch("/api/canvases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: action.title,
            type: action.canvasType,
            initialBlocks: action.initialBlocks,
            actor: "litt",
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to create canvas" };
        }
        const data = await res.json();
        return { ok: true, data };
      }
      case "canvas.append": {
        const res = await fetch(`/api/canvases/${action.canvasId}/blocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: action.blocks,
            actor: "litt",
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to append blocks" };
        }
        const data = await res.json();
        return { ok: true, data };
      }
      case "canvas.update_block": {
        const res = await fetch(
          `/api/canvases/${action.canvasId}/blocks/${action.blockId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patch: action.patch, actor: "litt" }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to update block" };
        }
        const data = await res.json();
        return { ok: true, data };
      }
      case "canvas.delete_block": {
        const res = await fetch(
          `/api/canvases/${action.canvasId}/blocks/${action.blockId}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actor: "litt" }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to delete block" };
        }
        return { ok: true };
      }
      case "canvas.rename": {
        const res = await fetch(`/api/canvases/${action.canvasId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: action.title, actor: "litt" }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to rename canvas" };
        }
        const data = await res.json();
        return { ok: true, data };
      }
      case "task.create": {
        // Task creation appends a task block to the active canvas
        // (or creates a new planning canvas if none active)
        const canvasId = action.canvasId;
        if (canvasId) {
          const res = await fetch(`/api/canvases/${canvasId}/blocks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blocks: [{
                type: "task",
                content: {
                  title: action.title,
                  description: action.description,
                  status: "todo",
                  taskId: null,
                },
              }],
              actor: "litt",
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { ok: false, error: err.error ?? "Failed to create task" };
          }
          const data = await res.json();
          return { ok: true, data };
        }
        // No active canvas — create a new planning canvas with the task
        const res = await fetch("/api/canvases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Tasks",
            type: "planning",
            initialBlocks: [{
              type: "task",
              content: {
                title: action.title,
                description: action.description,
                status: "todo",
                taskId: null,
              },
            }],
            actor: "litt",
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to create task canvas" };
        }
        const data = await res.json();
        return { ok: true, data };
      }
      case "project.promote": {
        const res = await fetch(`/api/canvases/${action.canvasId}/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { ok: false, error: err.error ?? "Failed to promote canvas" };
        }
        const data = await res.json();
        return { ok: true, data };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
