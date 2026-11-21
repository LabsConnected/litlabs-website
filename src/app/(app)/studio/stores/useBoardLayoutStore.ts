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
  clampPanelsToArea,
  clampRect,
  defaultBoardLayout,
  findOpenPosition,
  overviewViewport,
  seedPanelRect,
  tidyPanels,
  topZ,
} from "../components/board/board-layout";
import {
  BOARD_CHAT_UNTOUCHED_DEFAULT_RECT,
  BOARD_DESIGN_AREA,
  REMOVED_BOARD_PANEL_IDS,
  boardDefinition,
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
const BOARD_LAYOUT_V2_WEBSITE_OPEN: BoardPanelId[] = ["files", "health", "deploy"];

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
 *
 * v2 → v3 (board-only rebuild, 2026-11-14): the board is now the whole
 * Studio and the panel inventory grew (chat, plan, canvas, activity,
 * browser) with a new default arrangement from Larry's Command Center
 * mockup. Old panel records cannot describe the new panels at all, and
 * old geometry referenced the retired right-dock area, so every scope's
 * panels re-seed from the new defaults exactly once, here. Presets,
 * the active preset name and viewports carry over untouched — and
 * applyPreset backfills any panel a v2-era preset does not know.
 */
/** True when a rect is exactly chat's pre-centering default — the
 *  untouched-default signature (see BOARD_CHAT_UNTOUCHED_DEFAULT_RECT). */
function isUntouchedChatRect(rect: BoardRect | undefined): boolean {
  return (
    !!rect &&
    rect.x === BOARD_CHAT_UNTOUCHED_DEFAULT_RECT.x &&
    rect.y === BOARD_CHAT_UNTOUCHED_DEFAULT_RECT.y &&
    rect.width === BOARD_CHAT_UNTOUCHED_DEFAULT_RECT.width &&
    rect.height === BOARD_CHAT_UNTOUCHED_DEFAULT_RECT.height
  );
}

/**
 * Drop retired panel ids (inspector / plan / canvas) from a panels
 * record. Returns the SAME record when nothing is removed, so layouts
 * without retired panels pass through byte-identical.
 */
function dropRemovedPanels<T extends Record<string, unknown>>(panels: T): T {
  if (!panels || typeof panels !== "object") return panels;
  if (!REMOVED_BOARD_PANEL_IDS.some((id) => id in panels)) return panels;
  const next: Record<string, unknown> = {};
  for (const [id, panel] of Object.entries(panels)) {
    if (!REMOVED_BOARD_PANEL_IDS.includes(id)) next[id] = panel;
  }
  return next as T;
}

/**
 * v4 → v5 (2026-11-16 layout spec): two surgical changes, nothing else.
 *
 * 1. Centered chat: a chat panel still sitting at EXACTLY its old
 *    untouched default rect (16,16,404,768) was never moved by the
 *    user, so it moves to the centered-top seed (computed against the
 *    board design area — a migration has no live board area; the live
 *    board rescues panels into view as usual). A chat the user moved
 *    or resized keeps its rect exactly (Larry's standing rule: saved
 *    layouts untouched).
 * 2. Retired panels: layouts (and presets) carrying inspector / plan /
 *    canvas entries load without crashing — those entries are dropped.
 *    Preset chat rects are NOT recentered: a preset is a chosen
 *    arrangement, and only the live scope layout migrates.
 *
 * Scopes needing neither change keep their exact object identity.
 */
function migrateLayoutV4ToV5(layout: BoardLayoutState): BoardLayoutState {
  if (!layout || !layout.panels) return layout;
  let panels = dropRemovedPanels(layout.panels);
  const chat = panels.chat;
  if (chat && isUntouchedChatRect(chat.rect)) {
    panels = { ...panels, chat: { ...chat, rect: seedPanelRect("chat", BOARD_DESIGN_AREA) } };
  }
  let presets = layout.presets;
  if (presets) {
    let presetsChanged = false;
    const nextPresets: typeof presets = {};
    for (const [name, preset] of Object.entries(presets)) {
      const cleaned = preset?.panels ? dropRemovedPanels(preset.panels) : preset?.panels;
      if (preset && cleaned !== preset.panels) {
        presetsChanged = true;
        nextPresets[name] = { ...preset, panels: cleaned };
      } else {
        nextPresets[name] = preset;
      }
    }
    if (presetsChanged) presets = nextPresets;
  }
  if (panels === layout.panels && presets === layout.presets) return layout;
  return { ...layout, panels, presets };
}

export function migrateBoardLayoutPersistedState(
  persistedState: unknown,
  version: number,
): BoardLayoutPersistedState {
  if (
    version >= 5 ||
    !persistedState ||
    typeof persistedState !== "object" ||
    !("scopes" in persistedState) ||
    !persistedState.scopes ||
    typeof persistedState.scopes !== "object"
  ) {
    return persistedState as BoardLayoutPersistedState;
  }
  const state = persistedState as BoardLayoutPersistedState;
  // v3 → v4 (Studio Finish Spec, Larry 2026-11-14): the Terminal panel
  // is closed until requested. A terminal still sitting at its exact
  // default rect, open and untouched, is the old default — close it
  // once. A terminal the user moved, resized, minimized or maximized
  // was deliberately arranged and keeps its state.
  if (version === 3) {
    const scopes: Record<string, BoardLayoutState> = {};
    for (const [key, layout] of Object.entries(state.scopes)) {
      const terminal = layout?.panels?.terminal;
      const def = boardDefinition("terminal").defaultRect;
      const untouched =
        terminal &&
        terminal.open &&
        !terminal.minimized &&
        !terminal.maximized &&
        terminal.rect.x === def.x &&
        terminal.rect.y === def.y &&
        terminal.rect.width === def.width &&
        terminal.rect.height === def.height;
      const nextLayout = untouched
        ? { ...layout, panels: { ...layout.panels, terminal: { ...terminal, open: false } } }
        : layout;
      // Chain into the v4 → v5 step so a v3 save lands fully current.
      scopes[key] = migrateLayoutV4ToV5(nextLayout);
    }
    return { ...state, scopes };
  }
  if (version === 4) {
    const scopes: Record<string, BoardLayoutState> = {};
    for (const [key, layout] of Object.entries(state.scopes)) {
      scopes[key] = migrateLayoutV4ToV5(layout);
    }
    return { ...state, scopes };
  }
  const scopes: Record<string, BoardLayoutState> = {};
  for (const [key, layout] of Object.entries(state.scopes)) {
    if (!layout || !layout.panels) {
      scopes[key] = layout;
      continue;
    }
    let panels = layout.panels;
    if (version < 2 && layout.projectType === "website") {
      panels = { ...panels };
      for (const id of BOARD_LAYOUT_V2_WEBSITE_OPEN) {
        const panel = panels[id];
        if (panel && !panel.open) panels[id] = { ...panel, open: true };
      }
    }
    scopes[key] = migrateLayoutV4ToV5({
      ...layout,
      panels: defaultBoardLayout(layout.projectType ?? "website").panels,
    });
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
  /** Maximize fills the passed REGION in board coordinates (origin +
   *  size) — the board chrome passes its visible region, so a
   *  maximized panel snaps to exactly what the user sees, pan and
   *  zoom included (mapping §7). Un-maximizing restores the prior rect. */
  toggleMaximize: (scope: string, id: BoardPanelId, region: BoardRect) => void;
  bringToFront: (scope: string, id: BoardPanelId) => void;
  setPanelRect: (scope: string, id: BoardPanelId, rect: BoardRect) => void;
  setViewport: (scope: string, viewport: BoardViewport) => void;

  /** Reachability guard: pull panels stranded outside a shrunken board
   *  area back inside it. Never opens, closes or rearranges a panel that
   *  is already reachable — it only rescues off-canvas ones. */
  clampPanels: (scope: string, area: { width: number; height: number }) => void;
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
          withScope(s, scope, (layout) => {
            const panel = layout.panels[id];
            if (!panel) return layout;
            if (panel.open) {
              // Re-summon of an already-open panel only raises it (and
              // un-minimizes) — its size is the user's current choice,
              // not a summon-from-closed (mapping §8.2).
              return updatePanel(layout, id, {
                open: true,
                minimized: false,
                z: topZ(layout) + 1,
              });
            }
            // Summon from CLOSED resets the panel to its FULL default
            // size (spec §4b: panels open full size — a panel once
            // shrunk must not reopen shrunk forever). Position is
            // kept; tray restore and preset application deliberately
            // do NOT reset size (mapping §8.3).
            const def = boardDefinition(id);
            let rect = clampRect({
              x: panel.rect.x,
              y: panel.rect.y,
              width: def.defaultRect.width,
              height: def.defaultRect.height,
            });
            // Placement guard (live defect, Larry 2026-11-20): a
            // panel still sitting at its UNTOUCHED default position
            // was never placed by the user, and several defaults
            // share one rect (preview / code / browser / world at
            // 436,72) — summoning it landed it exactly on an
            // already-open panel, burying that panel. Search for a
            // non-stacking spot instead. A position the user chose
            // (moved panel, tray restore, preset) is kept exactly.
            if (rect.x === def.defaultRect.x && rect.y === def.defaultRect.y) {
              const occupied = Object.values(layout.panels)
                .filter((p) => p.id !== id && p.open && !p.minimized)
                .map((p) => p.rect);
              rect = findOpenPosition(rect, occupied, BOARD_DESIGN_AREA);
            }
            return updatePanel(layout, id, {
              open: true,
              minimized: false,
              maximized: false,
              restoreRect: null,
              rect,
              z: topZ(layout) + 1,
            });
          }),
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

      toggleMaximize: (scope, id, region) =>
        set((s) =>
          withScope(s, scope, (layout) => {
            const panel = layout.panels[id];
            if (!panel) return layout;
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
              // Fill the REGION itself — origin included. Anchoring at
              // (0,0) was the defect: under pan/zoom the maximized
              // panel landed at the board origin, off-screen, with
              // drag disabled while maximized (mapping §7).
              rect: {
                x: Math.round(region.x),
                y: Math.round(region.y),
                width: Math.max(1, Math.round(region.width)),
                height: Math.max(1, Math.round(region.height)),
              },
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

      clampPanels: (scope, area) =>
        set((s) =>
          withScope(s, scope, (layout) => ({
            ...layout,
            panels: clampPanelsToArea(layout.panels, area),
          })),
        ),

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
              // Backfill panels the preset predates (v2-era presets do
              // not know chat / activity / browser) so the record is
              // always complete — and drop retired ids a pre-v5 preset
              // still carries (inspector / plan / canvas).
              panels: {
                ...defaultBoardLayout(layout.projectType).panels,
                ...dropRemovedPanels(structuredClone(preset.panels)),
              },
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
      version: 5,
      migrate: migrateBoardLayoutPersistedState,
      partialize: (s) => ({ enabledByUser: s.enabledByUser, scopes: s.scopes }),
    },
  ),
);

/**
 * Legacy per-user board toggle (B2 transition rule). The board-only
 * shell no longer reads it — the board is simply what Studio is — but
 * the persisted field and this hook stay for compatibility with any
 * surface that still references them.
 */
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
