"use client";

/**
 * Studio Browser store — the one home for the embedded browser's tab
 * state (tabs, per-tab history, the active tab).
 *
 * The Browser panel (components/board/BoardBrowserPanel) has two
 * homes: a board panel in the Board layout and a StudioDock tab in
 * the Regular layout. A layout flip swaps the body branch in
 * CommandStudio and unmounts the panel, so component-local tab state
 * reset on every flip (live check, 2026-11-22: Board → Regular →
 * Board came back to a fresh "New tab"). The tab state lives here
 * instead — module-scoped and layout-independent, the same pattern
 * the terminal log store uses — so tabs, history, and the address
 * bar survive flips, dock closes, and panel closes. On remount the
 * panel reloads the active tab's current page from its stored frame
 * src, matching the panel's documented tab model (history and
 * address are kept; live page state is not).
 *
 * Only one real panel instance is ever mounted: the Board layout
 * mounts it as a board panel, the Regular layout as a dock tab, and
 * the shell's bottom dock carries a jump panel instead of a second
 * browser — so there is a single writer to this store.
 */

import { create } from "zustand";

export type StudioBrowserEmbedStatus = "loading" | "loaded" | "blocked";

export interface StudioBrowserTab {
  id: number;
  history: string[];
  historyIndex: number;
  input: string;
  reloadKey: number;
  /** Proxy URL the frame should load; null when the tab has no page yet. */
  frameSrc: string | null;
  status: StudioBrowserEmbedStatus;
}

/** Normalize a typed address into a loadable URL, or null if empty. */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function studioBrowserTabCurrentUrl(tab: StudioBrowserTab): string | null {
  return tab.historyIndex >= 0 ? tab.history[tab.historyIndex] : null;
}

export function studioBrowserTabLabel(tab: StudioBrowserTab): string {
  const url = studioBrowserTabCurrentUrl(tab);
  if (!url) return "New tab";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

let nextTabId = 1;
export function freshStudioBrowserTab(): StudioBrowserTab {
  return {
    id: nextTabId++,
    history: [],
    historyIndex: -1,
    input: "",
    reloadKey: 0,
    frameSrc: null,
    status: "loaded",
  };
}

interface StudioBrowserState {
  tabs: StudioBrowserTab[];
  activeTabId: number;
  updateTab: (tabId: number, patch: Partial<StudioBrowserTab>) => void;
  setActiveTabId: (tabId: number) => void;
  addTab: () => void;
  closeTab: (tabId: number) => void;
  /** Back to a single fresh tab (tests; a future "close all" affordance). */
  reset: () => void;
}

function initialTabs(): { tabs: StudioBrowserTab[]; activeTabId: number } {
  const tab = freshStudioBrowserTab();
  return { tabs: [tab], activeTabId: tab.id };
}

export const useStudioBrowserStore = create<StudioBrowserState>((set, get) => ({
  ...initialTabs(),
  updateTab: (tabId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    })),
  setActiveTabId: (tabId) => set({ activeTabId: tabId }),
  addTab: () => {
    const tab = freshStudioBrowserTab();
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
  },
  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const next = tabs.filter((t) => t.id !== tabId);
    if (next.length === 0) {
      const replacement = freshStudioBrowserTab();
      set({ tabs: [replacement], activeTabId: replacement.id });
      return;
    }
    if (tabId === activeTabId) {
      const neighbor = next[Math.min(idx, next.length - 1)];
      set({ tabs: next, activeTabId: neighbor.id });
    } else {
      set({ tabs: next });
    }
  },
  reset: () => set(initialTabs()),
}));
