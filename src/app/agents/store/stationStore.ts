"use client";

/**
 * LiTT Base Station — client store.
 *
 * Holds the visual state of the Base Station: where LiTT and Spark are
 * positioned on the 2.5D canvas, which mode the user is in, the active
 * skin, and which agent / panel is currently focused. Persists to Supabase
 * via the `useStationLayout` hook.
 *
 * This is a small, dependency-free implementation (no Zustand, no Redux).
 * It exposes a `useStationStore()` hook and a `getStationSnapshot()` for
 * non-React reads. The store is module-singleton; in practice each browser
 * tab has exactly one Base Station.
 */

import { useEffect, useState } from "react";

export type StationMode = "explore" | "edit" | "command";

export type AgentId = "litt" | "spark";

export interface AgentPlacement {
  /** Pixels from the left edge of the viewport (the 2.5D canvas). */
  x: number;
  /** Pixels from the top edge of the viewport. */
  y: number;
  /** Scale multiplier (0.5 = half size, 2 = double). Defaults to 1. */
  scale?: number;
  /** Visual rotation in degrees. Defaults to 0. */
  rotation?: number;
}

export interface StationLayout {
  /** Version, monotonically incremented on every write. Used for conflict detection. */
  version: number;
  /** Per-agent position on the canvas. */
  placements: Record<AgentId, AgentPlacement>;
  /** Active mode (explore = pan/zoom, edit = drag agents, command = mission composer). */
  mode: StationMode;
  /** Active skin identifier. UI-defined; stored as an opaque string. */
  skin: string;
  /** Per-agent color overrides. Allows the user to recolor LiTT or Spark from the customizer. */
  colors: Partial<Record<AgentId, string>>;
  /** Saved home zone identifier. Optional. */
  homeZone?: string;
  /** When the layout was last saved (ms epoch). Null if never saved. */
  savedAt: number | null;
}

const STORAGE_KEY = "litlabs.station.layout.v1";

const DEFAULT_LAYOUT: StationLayout = {
  version: 1,
  placements: {
    litt:   { x: 220, y: 220, scale: 1, rotation: 0 },
    spark:  { x: 540, y: 280, scale: 1, rotation: 0 },
  },
  mode: "explore",
  skin: "neon-midnight",
  colors: {},
  homeZone: undefined,
  savedAt: null,
};

/* ------------------------------------------------------------------ */
/*  Module-singleton store                                              */
/* ------------------------------------------------------------------ */

let currentLayout: StationLayout = { ...DEFAULT_LAYOUT };
const listeners = new Set<() => void>();

function setLayout(next: StationLayout) {
  currentLayout = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStationSnapshot(): StationLayout {
  return currentLayout;
}

export type StationPatch = Partial<Omit<StationLayout, "version">> & {
  version?: number;
};

export function patchStation(patch: StationPatch) {
  setLayout({
    ...currentLayout,
    ...patch,
    version: (patch.version ?? currentLayout.version) + 1,
  });
}

export function moveAgent(agentId: AgentId, placement: Partial<AgentPlacement>) {
  patchStation({
    placements: {
      ...currentLayout.placements,
      [agentId]: {
        ...currentLayout.placements[agentId],
        ...placement,
      },
    },
  });
}

export function setAgentColor(agentId: AgentId, color: string | null) {
  const next = { ...currentLayout.colors };
  if (color === null) {
    delete next[agentId];
  } else {
    next[agentId] = color;
  }
  patchStation({ colors: next });
}

export function setMode(mode: StationMode) {
  patchStation({ mode });
}

export function setSkin(skin: string) {
  patchStation({ skin });
}

/**
 * LocalStorage persistence. SSR-safe (returns early on the server).
 * The Supabase round-trip happens in `useStationLayout`.
 */
export function loadFromLocalStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<StationLayout>;
    setLayout({ ...DEFAULT_LAYOUT, ...parsed, savedAt: parsed.savedAt ?? null });
    return true;
  } catch {
    return false;
  }
}

export function saveToLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentLayout));
  } catch {
    /* quota / private mode — fail silently */
  }
}

export function resetLayout() {
  setLayout({ ...DEFAULT_LAYOUT, savedAt: currentLayout.savedAt });
}

/* ------------------------------------------------------------------ */
/*  React hook                                                          */
/* ------------------------------------------------------------------ */

/**
 * Subscribe to the station store. Returns the current layout. Re-renders
 * the consumer when any field changes.
 */
export function useStationStore(): StationLayout {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribe(() => setTick((t) => t + 1));
    return unsubscribe;
  }, []);
  return currentLayout;
}
