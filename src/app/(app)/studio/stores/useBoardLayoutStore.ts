"use client";

/**
 * Board layout store (plan §2 B1 + additions).
 *
 * One store, layouts scoped per user + per project, persisted to
 * localStorage so an arrangement honestly survives reload. Server sync is
 * a deliberate follow-up (plan B1 names the `updateProjectWorkspaceType`
 * precedent in project-repository.ts); nothing here pretends otherwise.
 *
 * Movement rule (Phase 0, Larry): panels open/move ONLY on user action.
 * Every mutator below is invoked from a user gesture in the board UI —
 * or, the single approved exception, by the in-Studio LiTT on Larry's
 * explicit in-chat ask ("LiTT panel control" addition), which reaches the
 * same actions hook-free via `useBoardLayoutStore.getState()`. The system
 * never calls these on its own initiative.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  clampRect,
  defaultBoardLayout,
  overviewViewport,
  tidyPanels,
  topZ,
} from "../components/board/board-layout";
import {
  boardScopeKey,
  type BoardLayoutState,
  type BoardPanelId,
  type BoardPanelState,
  type BoardProjectType,
  type BoardRect,
  type BoardViewport,
} from "../components/board/board-types";

export const BOARD_LAYOUT_STORAGE_KEY = "litt-studio-board-layout-v1";

/** The persisted (partialized) shape of this store. */
export interface BoardLayoutPersistedState {
  enabledByUser: Record<string, boolean>;
  scopes: Record<string, BoardLayoutState>;
}

/**
 * Panels whose website default changed in layout v2 (board slice 1,
 * 2026-11-14 — Larry's rule: everything lives on the board, open by
 * default). Changes and Browser ride along inside the Inspector panel;
 * Checks' board home is the Health panel.
 */
const BOARD_LAYOUT_V2_WEBSITE_OPEN: BoardPanelId[] = ["files", "health", "inspector", "deploy"];

/**
 * zustand/persist migration for the board layout store.
 *
 * v1 → v2: v1 layouts recorded Files / Health / Inspector / Deploy as
 * closed on website projects purely because the old defaults never
 * opened them, so a saved layout cannot be told apart from a deliberate
 * close. The new defaults must reach existing users, so website scopes
 * re-open those four panels exactly once, here. Panel geometry,
 * z-order, minimized/maximized state, presets, viewports and every
 * other panel's open state carry over untouched — and a preset saved
 * under v1 still restores exactly what it saved when applied.
 * Anything unrecognized passes through unchanged.
 */
export function migrateBoardLayoutPersistedState(
  persistedState: unknown,
  version: number,
): BoardLayoutPersistedState {
  if (
    version >= 2 ||
    !persistedState ||
    typeof persistedState !== "object" ||
    !("scopes" in persistedState) ||
    !persistedState.scopes ||
    typeof persistedState.scopes !== "object"
  ) {
    return persistedState as BoardLayoutPersistedState;
  }
  const state = persistedState as BoardLayoutPersistedState;
  const scopes: Record<string, BoardLayoutState> = {};
  for (const [key, layout] of Object.entries(state.scopes)) {
    if (!layout || layout.projectType !== "website" || !layout.panels) {
      scopes[key] = layout;
      continue;
    }
    const panels = { ...layout.panels };
    for (const id of BOARD_LAYOUT_V2_WEBSITE_OPEN) {
      const panel = panels[id];
      if (panel && !panel.open) panels[id] = { ...panel, open: true };
    }
    scopes[key] = { ...layout, panels };
  }
  return { ...state, scopes };
}

interface BoardLayoutStore {
  /** Per-user board toggle. Absent/false = OFF (the B2 default). */
  enabledByUser: Record<string, boolean>;
  /** Layouts keyed by boardScopeKey(userId, projectId). */
  scopes: Record<string, BoardLayoutState>;

  setBoardEnabled: (userId: string, enabled: boolean) => void;
  /** Create the scope's default layout on first use. No-op afterwards,
   *  except that a project-type change is recorded (panels are kept). */
  ensureScope: (userId: string, projectId: string, projectType: BoardProjectType) => void;

  openPanel: (scope: string, id: BoardPanelId) => void;
  closePanel: (scope: string, id: BoardPanelId) => void;
  minimizePanel: (scope: string, id: BoardPanelId) => void;
  restorePanel: (scope: string, id: BoardPanelId) => void;
  toggleMaximize: (scope: string, id: BoardPanelId, area: { width: number; height: number }) => void;
  bringToFront: (scope: string, id: BoardPanelId) => void;
  setPanelRect: (scope: string, id: BoardPanelId, rect: BoardRect) => void;
  setViewport: (scope: string, viewport: BoardViewport) => void;

  /** Tidy addition: snap open panels into a clean grid (user-invoked). */
  tidy: (scope: string, area: { width: number; height: number }) => void;
  /** Zoom-out overview addition: frame all open panels; toggling again
   *  returns to the exact viewport captured on entry. */
  toggleOverview: (scope: string, container: { width: number; height: number }) => void;

  /** Presets addition: multiple named layouts per project. */
  savePreset: (scope: string, name: string) => void;
  applyPreset: (scope: string, name: string) => void;
  deletePreset: (scope: string, name: string) => void;
  /** B6 Reset: back to the prototype default for the project type. */
  resetLayout: (scope: string) => void;
}

function updatePanel(
  layout: BoardLayoutState,
  id: BoardPanelId,
  patch: Partial<BoardPanelState>,
): BoardLayoutState {
  return {
    ...layout,
    panels: { ...layout.panels, [id]: { ...layout.panels[id], ...patch } },
  };
}

function withScope(
  state: BoardLayoutStore,
  scope: string,
  fn: (layout: BoardLayoutState) => BoardLayoutState,
): Partial<BoardLayoutStore> {
  const layout = state.scopes[scope];
  if (!layout) return {};
  return { scopes: { ...state.scopes, [scope]: fn(layout) } };
}

export const useBoardLayoutStore = create<BoardLayoutStore>()(
  persist(
    (set) => ({
      enabledByUser: {},
      scopes: {},

      setBoardEnabled: (userId, enabled) =>
        set((s) => ({ enabledByUser: { ...s.enabledByUser, [userId]: enabled } })),

      ensureScope: (userId, projectId, projectType) =>
        set((s) => {
          const scope = boardScopeKey(userId, projectId);
          const existing = s.scopes[scope];
          if (!existing) {
            return { scopes: { ...s.scopes, [scope]: defaultBoardLayout(projectType) } };
          }
          if (existing.projectType !== projectType) {
            return { scopes: { ...s.scopes, [scope]: { ...existing, projectType } } };
          }
          return {};
        }),

      openPanel: (scope, id) =>
        set((s) =>
          withScope(s, scope, (layout) =>
            updatePanel(layout, id, {
              open: true,
              minimized: false,
              z: topZ(layout) + 1,
            }),
          ),
        ),

      closePanel: (scope, id) =>
        set((s) =>
          withScope(s, scope, (layout) =>
            updatePanel(layout, id, { open: false, minimized: false, maximized: false }),
          ),
        ),

      minimizePanel: (scope, id) =>
        set((s) =>
          withScope(s, scope, (layout) => updatePanel(layout, id, { minimized: true })),
        ),

      restorePanel: (scope, id) =>
        set((s) =>
          withScope(s, scope, (layout) =>
            updatePanel(layout, id, { minimized: false, open: true, z: topZ(layout) + 1 }),
          ),
        ),

      toggleMaximize: (scope, id, area) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            const panel = layout.panels[id];
            if (panel.maximized) {
              return updatePanel(layout, id, {
                maximized: false,
                rect: panel.restoreRect ?? panel.rect,
                restoreRect: null,
                z: topZ(layout) + 1,
              });
            }
            return updatePanel(layout, id, {
              maximized: true,
              restoreRect: panel.rect,
              rect: { x: 0, y: 0, width: Math.max(1, area.width), height: Math.max(1, area.height) },
              z: topZ(layout) + 1,
            });
          }),
        ),

      bringToFront: (scope, id) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            if (layout.panels[id].z === topZ(layout)) return layout;
            return updatePanel(layout, id, { z: topZ(layout) + 1 });
          }),
        ),

      setPanelRect: (scope, id, rect) =>
        set((s) =>
          withScope(s, scope, (layout) =>
            updatePanel(layout, id, { rect: clampRect(rect), maximized: false, restoreRect: null }),
          ),
        ),

      setViewport: (scope, viewport) =>
        set((s) => withScope(s, scope, (layout) => ({ ...layout, viewport }))),

      tidy: (scope, area) =>
        set((s) =>
          withScope(s, scope, (layout) => ({
            ...layout,
            panels: tidyPanels(layout.panels, area),
            activePresetName: null,
          })),
        ),

      toggleOverview: (scope, container) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            if (layout.overviewReturnViewport) {
              return {
                ...layout,
                viewport: layout.overviewReturnViewport,
                overviewReturnViewport: null,
              };
            }
            return {
              ...layout,
              overviewReturnViewport: layout.viewport,
              viewport: overviewViewport(layout.panels, container),
            };
          }),
        ),

      savePreset: (scope, name) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            const trimmed = name.trim();
            if (!trimmed) return layout;
            return {
              ...layout,
              activePresetName: trimmed,
              presets: {
                ...layout.presets,
                [trimmed]: {
                  name: trimmed,
                  savedAt: Date.now(),
                  panels: structuredClone(layout.panels),
                },
              },
            };
          }),
        ),

      applyPreset: (scope, name) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            const preset = layout.presets[name];
            if (!preset) return layout;
            return {
              ...layout,
              panels: structuredClone(preset.panels),
              activePresetName: name,
              overviewReturnViewport: null,
            };
          }),
        ),

      deletePreset: (scope, name) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            if (!layout.presets[name]) return layout;
            const presets = { ...layout.presets };
            delete presets[name];
            return {
              ...layout,
              presets,
              activePresetName: layout.activePresetName === name ? null : layout.activePresetName,
            };
          }),
        ),

      resetLayout: (scope) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            const fresh = defaultBoardLayout(layout.projectType);
            // Presets are the user's saved work — Reset restores the
            // working arrangement, it does not delete saved presets.
            return { ...fresh, presets: layout.presets };
          }),
        ),
    }),
    {
      name: BOARD_LAYOUT_STORAGE_KEY,
      version: 2,
      migrate: migrateBoardLayoutPersistedState,
      partialize: (s) => ({ enabledByUser: s.enabledByUser, scopes: s.scopes }),
    },
  ),
);

/** Board toggle for a user — defaults OFF (B2 transition rule). */
export function useBoardEnabled(userId: string | null | undefined): boolean {
  return useBoardLayoutStore((s) => (userId ? s.enabledByUser[userId] === true : false));
}

/** The layout for a user+project scope, or null before ensureScope runs. */
export function useBoardScope(
  userId: string | null | undefined,
  projectId: string | null | undefined,
): BoardLayoutState | null {
  return useBoardLayoutStore((s) =>
    userId && projectId ? (s.scopes[boardScopeKey(userId, projectId)] ?? null) : null,
  );
}
