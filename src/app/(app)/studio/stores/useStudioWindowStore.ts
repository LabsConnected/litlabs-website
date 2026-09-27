"use client";

/**
 * useStudioWindowStore — the single StudioWindowManager.
 *
 * The ONLY layer allowed to manage shared window behavior: creation and
 * destruction, focus and z-order, drag/resize results, minimize/restore/
 * maximize, dock state, viewport clamping, layout hydration/persistence,
 * per-project and per-task layout scopes, and workspace reset.
 *
 * Tool windows (Chat, Preview, Files, Terminal, …) render content only —
 * they never implement their own drag, z-index, geometry, or persistence.
 *
 * Persistence model:
 *   litt:studio:wm:v2:{projectId}          → live window set per project
 *   litt:studio:wm:layout:{project}:{task} → named StudioLayout snapshots
 *
 * Windows always carry taskId — task-level layouts are implicit in the
 * project window set (a task's windows are exactly the records bound to it).
 * saveLayout/restoreLayout provide explicit snapshots on top of that.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  StudioLayout,
  StudioLayoutScope,
  StudioWindow,
  StudioWindowBounds,
  StudioWindowDock,
  StudioWindowType,
} from "../types/studio-windows";

const WINDOWS_KEY = (projectId: string) => `litt:studio:wm:v2:${projectId}`;
const LAYOUT_KEY = (scope: StudioLayoutScope) =>
  `litt:studio:wm:layout:${scope.projectId}:${scope.taskId ?? "project"}`;

const BASE_Z = 40;
const MIN_W = 220;
const MIN_H = 160;

/** Staggered spawn bounds per type — intelligent default placement. */
const DEFAULT_BOUNDS: Record<StudioWindowType, StudioWindowBounds> = {
  chat:      { x: 24,  y: 24,  width: 400, height: 560 },
  preview:   { x: 460, y: 40,  width: 760, height: 560 },
  files:     { x: 60,  y: 320, width: 340, height: 420 },
  terminal:  { x: 320, y: 420, width: 640, height: 340 },
  inspector: { x: 520, y: 60,  width: 340, height: 520 },
  activity:  { x: 260, y: 180, width: 460, height: 420 },
  browser:   { x: 300, y: 120, width: 720, height: 520 },
  media:     { x: 360, y: 140, width: 560, height: 480 },
  plan:      { x: 200, y: 80,  width: 560, height: 560 },
  code:      { x: 160, y: 60,  width: 720, height: 560 },
  canvas:    { x: 140, y: 60,  width: 760, height: 560 },
};

const TYPE_TITLES: Record<StudioWindowType, string> = {
  chat: "Chat",
  preview: "Preview",
  files: "Files",
  terminal: "Terminal",
  inspector: "Inspector",
  activity: "Activity",
  browser: "Browser",
  media: "Media",
  plan: "Plan",
  code: "Code",
  canvas: "Canvas",
};

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function clampBounds(b: StudioWindowBounds): StudioWindowBounds {
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;
  const width = Math.max(MIN_W, Math.min(Math.round(b.width), Math.max(MIN_W, vw - 16)));
  const height = Math.max(MIN_H, Math.min(Math.round(b.height), Math.max(MIN_H, vh - 16)));
  // Keep at least a sliver of the titlebar on-screen: the window can slide
  // partially off-canvas but never fully out of reach.
  const x = Math.min(Math.max(Math.round(b.x), -width + 120), Math.max(8, vw - 120));
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(8, vh - 80));
  return { x, y, width, height };
}

/** Staggered default bounds for a new window of `type`. */
function defaultBounds(type: StudioWindowType, openCount: number): StudioWindowBounds {
  const base = DEFAULT_BOUNDS[type];
  const step = (openCount % 8) * 28;
  return clampBounds({ x: base.x + step, y: base.y + step, width: base.width, height: base.height });
}

function loadWindows(projectId: string): StudioWindow[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(WINDOWS_KEY(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { windows?: StudioWindow[] } | StudioWindow[];
    const list = Array.isArray(parsed) ? parsed : parsed.windows ?? [];
    return list.filter((w) => w && typeof w.id === "string" && w.projectId === projectId);
  } catch {
    return []; // corrupt layout state falls back to a clean canvas
  }
}

export interface OpenWindowInput {
  type: StudioWindowType;
  taskId: string;
  projectId: string;
  title?: string;
  /** Explicit id — deterministic ids reopen the same record. */
  id?: string;
  initialBounds?: Partial<StudioWindowBounds>;
  viewState?: Record<string, unknown>;
  /** When true, re-opening the same (type, taskId) focuses the existing
      window instead of spawning a duplicate. */
  singleton?: boolean;
  /** Focus the window on open. Default true. */
  activate?: boolean;
}

interface StudioWindowStoreState {
  windows: Record<string, StudioWindow>;
  activeWindowId: string | null;
  zCounter: number;
  /** Projects whose persisted windows have been loaded this session. */
  hydratedProjects: Record<string, true>;

  hydrateProject: (projectId: string) => void;

  openWindow: (input: OpenWindowInput) => string;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  updateBounds: (windowId: string, bounds: Partial<StudioWindowBounds>) => void;
  minimizeWindow: (windowId: string) => void;
  restoreWindow: (windowId: string) => void;
  maximizeWindow: (windowId: string) => void;
  dockWindow: (windowId: string, position: StudioWindowDock) => void;
  updateWindowState: (windowId: string, viewState: Record<string, unknown>) => void;
  updateWindowMeta: (windowId: string, patch: { title?: string; taskId?: string }) => void;

  saveLayout: (scope: StudioLayoutScope, name?: string) => void;
  restoreLayout: (scope: StudioLayoutScope) => void;
  resetWorkspace: (scope: StudioLayoutScope) => void;
}

function persistProject(get: () => StudioWindowStoreState, projectId: string) {
  const s = storage();
  if (!s) return;
  try {
    const windows = Object.values(get().windows).filter((w) => w.projectId === projectId);
    s.setItem(WINDOWS_KEY(projectId), JSON.stringify({ windows }));
  } catch {
    // Layout persistence is best-effort and must never break Studio.
  }
}

// Drag/resize write bounds on every pointermove — trailing-debounce those
// writes so a 60fps drag doesn't thrash localStorage.
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
function schedulePersist(get: () => StudioWindowStoreState, projectId: string) {
  const existing = persistTimers.get(projectId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    projectId,
    setTimeout(() => {
      persistTimers.delete(projectId);
      persistProject(get, projectId);
    }, 250),
  );
}

export const useStudioWindowStore = create<StudioWindowStoreState>((set, get) => {
  const touch = (w: StudioWindow, patch: Partial<StudioWindow>): StudioWindow => ({
    ...w,
    ...patch,
    updatedAt: new Date().toISOString(),
  });

  const commit = (projectId: string, patch: Partial<StudioWindowStoreState>, deferPersist = false) => {
    set(patch);
    if (deferPersist) schedulePersist(get, projectId);
    else persistProject(get, projectId);
  };

  return {
    windows: {},
    activeWindowId: null,
    zCounter: BASE_Z,
    hydratedProjects: {},

    hydrateProject: (projectId) => {
      const state = get();
      if (!projectId || state.hydratedProjects[projectId]) return;
      const saved = loadWindows(projectId);
      const next: Record<string, StudioWindow> = { ...state.windows };
      let maxZ = state.zCounter;
      for (const w of saved) {
        // Saved records are complete — revive them wholesale.
        next[w.id] = { ...w, bounds: clampBounds(w.bounds) };
        maxZ = Math.max(maxZ, w.zIndex + 1);
      }
      set({ windows: next, zCounter: maxZ, hydratedProjects: { ...state.hydratedProjects, [projectId]: true } });
    },

    openWindow: (input) => {
      const state = get();
      if (!state.hydratedProjects[input.projectId]) get().hydrateProject(input.projectId);

      if (input.singleton) {
        const existing = Object.values(get().windows).find(
          (w) => w.type === input.type && w.taskId === input.taskId && w.projectId === input.projectId,
        );
        if (existing) {
          get().focusWindow(existing.id);
          return existing.id;
        }
      }

      const now = new Date().toISOString();
      const openCount = Object.values(get().windows).filter((w) => w.projectId === input.projectId).length;
      const id = input.id ?? `win:${input.type}:${input.taskId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const prior = get().windows[id];
      const bounds = clampBounds({
        ...(prior?.bounds ?? defaultBounds(input.type, openCount)),
        ...input.initialBounds,
      });
      const activate = input.activate ?? true;
      const record: StudioWindow = {
        id,
        taskId: input.taskId,
        projectId: input.projectId,
        type: input.type,
        title: input.title ?? prior?.title ?? TYPE_TITLES[input.type],
        bounds,
        zIndex: activate ? get().zCounter : prior?.zIndex ?? BASE_Z,
        state: prior?.state ?? { minimized: false, maximized: false, docked: null },
        viewState: { ...(prior?.viewState ?? {}), ...(input.viewState ?? {}) },
        restoreBounds: prior?.restoreBounds,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      commit(input.projectId, {
        windows: { ...get().windows, [id]: record },
        zCounter: activate ? get().zCounter + 1 : get().zCounter,
        activeWindowId: activate ? id : get().activeWindowId,
      });
      return id;
    },

    closeWindow: (windowId) => {
      const win = get().windows[windowId];
      if (!win) return;
      const next = { ...get().windows };
      delete next[windowId];
      commit(win.projectId, {
        windows: next,
        activeWindowId: get().activeWindowId === windowId ? null : get().activeWindowId,
      });
    },

    focusWindow: (windowId) => {
      const win = get().windows[windowId];
      if (!win) return;
      const z = get().zCounter;
      commit(win.projectId, {
        windows: {
          ...get().windows,
          [windowId]: touch(win, {
            zIndex: z,
            state: { ...win.state, minimized: false, hidden: false },
          }),
        },
        zCounter: z + 1,
        activeWindowId: windowId,
      });
    },

    updateBounds: (windowId, bounds) => {
      const win = get().windows[windowId];
      if (!win || win.state.maximized || win.state.docked) return;
      commit(
        win.projectId,
        {
          windows: {
            ...get().windows,
            [windowId]: touch(win, { bounds: clampBounds({ ...win.bounds, ...bounds }) }),
          },
        },
        true,
      );
    },

    minimizeWindow: (windowId) => {
      const win = get().windows[windowId];
      if (!win) return;
      commit(win.projectId, {
        windows: {
          ...get().windows,
          [windowId]: touch(win, { state: { ...win.state, minimized: true } }),
        },
        activeWindowId: get().activeWindowId === windowId ? null : get().activeWindowId,
      });
    },

    restoreWindow: (windowId) => {
      const win = get().windows[windowId];
      if (!win) return;
      commit(win.projectId, {
        windows: {
          ...get().windows,
          [windowId]: touch(win, { state: { ...win.state, minimized: false, hidden: false } }),
        },
      });
      get().focusWindow(windowId);
    },

    maximizeWindow: (windowId) => {
      const win = get().windows[windowId];
      if (!win) return;
      const maximizing = !win.state.maximized;
      commit(win.projectId, {
        windows: {
          ...get().windows,
          [windowId]: touch(win, {
            state: { ...win.state, maximized: maximizing, docked: null, minimized: false },
            restoreBounds: maximizing ? win.bounds : win.restoreBounds,
          }),
        },
      });
      if (maximizing) get().focusWindow(windowId);
    },

    dockWindow: (windowId, position) => {
      const win = get().windows[windowId];
      if (!win) return;
      const docking = position !== null;
      commit(win.projectId, {
        windows: {
          ...get().windows,
          [windowId]: touch(win, {
            state: { ...win.state, docked: position, maximized: false, minimized: false },
            restoreBounds: docking ? win.bounds : win.restoreBounds,
            bounds: !docking && win.restoreBounds ? win.restoreBounds : win.bounds,
          }),
        },
      });
      if (docking) get().focusWindow(windowId);
    },

    updateWindowState: (windowId, viewState) => {
      const win = get().windows[windowId];
      if (!win) return;
      commit(win.projectId, {
        windows: {
          ...get().windows,
          [windowId]: touch(win, { viewState: { ...win.viewState, ...viewState } }),
        },
      });
    },

    updateWindowMeta: (windowId, patch) => {
      const win = get().windows[windowId];
      if (!win) return;
      commit(win.projectId, {
        windows: { ...get().windows, [windowId]: touch(win, patch) },
      });
    },

    saveLayout: (scope, name) => {
      const s = storage();
      if (!s) return;
      const windows = Object.values(get().windows).filter(
        (w) => w.projectId === scope.projectId && (!scope.taskId || w.taskId === scope.taskId),
      );
      const layout: StudioLayout = {
        id: `layout:${scope.projectId}:${scope.taskId ?? "project"}`,
        projectId: scope.projectId,
        taskId: scope.taskId ?? null,
        name,
        version: 1,
        windows,
        updatedAt: new Date().toISOString(),
      };
      try { s.setItem(LAYOUT_KEY(scope), JSON.stringify(layout)); } catch { /* optional */ }
    },

    restoreLayout: (scope) => {
      const s = storage();
      if (!s) return;
      try {
        const raw = s.getItem(LAYOUT_KEY(scope));
        if (!raw) return;
        const layout = JSON.parse(raw) as StudioLayout;
        const next = { ...get().windows };
        // Replace the scope's current windows with the snapshot.
        for (const w of Object.values(next)) {
          if (w.projectId === scope.projectId && (!scope.taskId || w.taskId === scope.taskId)) {
            delete next[w.id];
          }
        }
        let maxZ = get().zCounter;
        for (const w of layout.windows) {
          next[w.id] = { ...w, bounds: clampBounds(w.bounds), state: { ...w.state, minimized: false } };
          maxZ = Math.max(maxZ, w.zIndex + 1);
        }
        set({ windows: next, zCounter: maxZ });
        persistProject(get, scope.projectId);
      } catch {
        // corrupt snapshot → keep current layout
      }
    },

    resetWorkspace: (scope) => {
      const next = { ...get().windows };
      for (const w of Object.values(next)) {
        if (w.projectId === scope.projectId && (!scope.taskId || w.taskId === scope.taskId)) {
          delete next[w.id];
        }
      }
      set({
        windows: next,
        activeWindowId: next[get().activeWindowId ?? ""] ? get().activeWindowId : null,
      });
      const s = storage();
      if (s) {
        try {
          s.removeItem(LAYOUT_KEY(scope));
          if (scope.taskId) {
            // Task-scoped reset: persist the project's surviving windows.
            persistProject(get, scope.projectId);
          } else {
            s.removeItem(WINDOWS_KEY(scope.projectId));
          }
        } catch { /* optional */ }
      }
    },
  };
});

/** The imperative manager surface — same contract, usable outside React. */
export const studioWindowManager = {
  openWindow: (input: OpenWindowInput) => useStudioWindowStore.getState().openWindow(input),
  closeWindow: (id: string) => useStudioWindowStore.getState().closeWindow(id),
  focusWindow: (id: string) => useStudioWindowStore.getState().focusWindow(id),
  updateBounds: (id: string, bounds: Partial<StudioWindowBounds>) => useStudioWindowStore.getState().updateBounds(id, bounds),
  minimizeWindow: (id: string) => useStudioWindowStore.getState().minimizeWindow(id),
  restoreWindow: (id: string) => useStudioWindowStore.getState().restoreWindow(id),
  maximizeWindow: (id: string) => useStudioWindowStore.getState().maximizeWindow(id),
  dockWindow: (id: string, pos: StudioWindowDock) => useStudioWindowStore.getState().dockWindow(id, pos),
  updateWindowState: (id: string, viewState: Record<string, unknown>) => useStudioWindowStore.getState().updateWindowState(id, viewState),
  saveLayout: (scope: StudioLayoutScope, name?: string) => useStudioWindowStore.getState().saveLayout(scope, name),
  restoreLayout: (scope: StudioLayoutScope) => useStudioWindowStore.getState().restoreLayout(scope),
  resetWorkspace: (scope: StudioLayoutScope) => useStudioWindowStore.getState().resetWorkspace(scope),
};

/** Selector helpers */
export const useStudioWindow = (id: string | null) =>
  useStudioWindowStore((s) => (id ? s.windows[id] : undefined));

export const useProjectWindows = (projectId: string | null) =>
  useStudioWindowStore(
    useShallow((s) =>
      Object.values(s.windows).filter((w) => !projectId || w.projectId === projectId),
    ),
  );

export const useActiveStudioWindow = () =>
  useStudioWindowStore((s) => (s.activeWindowId ? s.windows[s.activeWindowId] : undefined));

export { TYPE_TITLES as STUDIO_WINDOW_TITLES };
