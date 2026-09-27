"use client";

import { useCallback, useSyncExternalStore } from "react";

export type StudioWindowType = "chat" | "preview" | "files" | "terminal" | "inspector" | "activity" | "browser";
export type StudioWindowBounds = { x: number; y: number; width: number; height: number };
export type StudioWindowState = {
  id: string;
  taskId: string;
  type: StudioWindowType;
  bounds: StudioWindowBounds;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  docked: "left" | "right" | "top" | "bottom" | null;
  viewState: Record<string, unknown>;
};

type Scope = { projectId: string; taskId?: string | null };
type Listener = () => void;
const listeners = new Set<Listener>();
const windows = new Map<string, StudioWindowState>();
const loadedScopes = new Set<string>();
const snapshotCache = new Map<string, StudioWindowState[]>();
let nextZ = 40;
function scopeKey(scope: Scope) { return `litt:studio:layout:${scope.projectId}:${scope.taskId ?? "project"}`; }
function notify() {
  for (const key of loadedScopes) snapshotCache.set(key, [...windows.values()].filter((item) => item.id.startsWith(`${key}:`)));
  listeners.forEach((listener) => listener());
}
function persist(scope: Scope) {
  if (typeof window === "undefined") return;
  const prefix = `${scopeKey(scope)}:`;
  const scoped = [...windows.values()].filter((item) => item.id.startsWith(prefix));
  try { window.localStorage.setItem(scopeKey(scope), JSON.stringify(scoped)); } catch { /* optional preference */ }
}
function ensureScope(scope: Scope) {
  const key = scopeKey(scope);
  if (loadedScopes.has(key) || typeof window === "undefined") return;
  loadedScopes.add(key);
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]") as StudioWindowState[];
    for (const item of saved) windows.set(item.id, item);
    nextZ = Math.max(nextZ, ...saved.map((item) => item.zIndex + 1), 40);
    snapshotCache.set(key, [...saved]);
  } catch { /* corrupt layout falls back to defaults */ }
}

export const studioWindowManager = {
  openWindow(input: Omit<StudioWindowState, "zIndex" | "minimized" | "maximized" | "docked" | "viewState"> & Partial<Pick<StudioWindowState, "minimized" | "maximized" | "docked" | "viewState">>, scope?: Scope) {
    const current = windows.get(input.id);
    windows.set(input.id, {
      ...current, ...input,
      zIndex: current?.zIndex ?? nextZ++, minimized: current?.minimized ?? input.minimized ?? false,
      maximized: current?.maximized ?? input.maximized ?? false, docked: current?.docked ?? input.docked ?? null,
      viewState: current?.viewState ?? input.viewState ?? {},
    });
    if (scope) persist(scope);
    notify();
  },
  updateWindow(id: string, patch: Partial<StudioWindowState>, scope: Scope) {
    const current = windows.get(id); if (!current) return;
    windows.set(id, { ...current, ...patch }); persist(scope); notify();
  },
  focusWindow(id: string, scope: Scope) {
    const current = windows.get(id); if (!current) return;
    windows.set(id, { ...current, zIndex: nextZ++, minimized: false }); persist(scope); notify();
  },
  closeWindow(id: string, scope: Scope) { windows.delete(id); persist(scope); notify(); },
  resetWorkspace(scope: Scope) {
    const prefix = `${scopeKey(scope)}:`;
    for (const id of [...windows.keys()]) if (id.startsWith(prefix)) windows.delete(id);
    try { window.localStorage.removeItem(scopeKey(scope)); } catch { /* optional preference */ }
    notify();
  },
};

export function useStudioWindowManager(scope: Scope) {
  const key = scopeKey(scope);
  const subscribe = useCallback((listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); }, []);
  const getSnapshot = useCallback(() => { ensureScope(scope); return snapshotCache.get(key) ?? []; }, [key, scope]);
  const scopedWindows = useSyncExternalStore(subscribe, getSnapshot, () => []);
  return { windows: scopedWindows, manager: studioWindowManager };
}
