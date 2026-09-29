"use client";

/**
 * Item 5a — DEMOTED: localStorage (`litt:activityEvents`) is a
 * write-through CACHE ONLY. It is NEVER the Activity truth.
 *
 * The authoritative Activity feed is the persisted `action_events` log of
 * the run (`src/lib/action-runtime/run-store.ts` → `listActionEvents`),
 * written by the agent loop's `persistEvent` hook while the run executes
 * and read back by `StudioActivityPanel` via `GET /api/action-runs/[runId]`.
 * Nothing renders this store's contents — it exists only so UI-invoked
 * station actions (see `../lib/station-context.ts`) leave a local trace
 * even when no run is attached.
 */

import { create } from "zustand";
import type { ExecutionPhase } from "./useExecutionStore";

const STORAGE_KEY = "litt:activityEvents";
const MAX_EVENTS = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PersistedActivityEvent {
  id: string;
  type: "message" | "file" | "build" | "deploy" | "agent" | "error" | "voice" | "mission";
  source: "litt" | "spark" | "user" | "system";
  category: string;
  label: string;
  detail?: string;
  timestamp: number;
  status: "success" | "pending" | "error" | "info";
  conversationId?: string;
  /**
   * Station Control bridge (§9 activity format: { timestamp, station,
   * summary, phase }). Additive — existing producers are untouched.
   */
  /** Which station produced the entry (contract StationId), e.g. "browser". */
  station?: string;
  /** Human-readable summary, e.g. "Opened Stripe documentation". */
  summary?: string;
  /** Execution phase at the time of the entry. */
  phase?: ExecutionPhase;
}

interface ActivityStore {
  events: PersistedActivityEvent[];
  addEvent: (event: PersistedActivityEvent) => void;
  clearAll: () => void;
  clearOlderThan: (ms: number) => void;
}

function loadFromStorage(): PersistedActivityEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedActivityEvent[];
    if (!Array.isArray(parsed)) return [];
    // Filter out events older than MAX_AGE_MS
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter((e) => e.timestamp > cutoff).slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function saveToStorage(events: PersistedActivityEvent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  events: loadFromStorage(),

  addEvent: (event) => {
    const current = get().events;
    // Deduplicate by id
    if (current.some((e) => e.id === event.id)) return;
    const next = [...current, event].slice(-MAX_EVENTS);
    saveToStorage(next);
    set({ events: next });
  },

  clearAll: () => {
    saveToStorage([]);
    set({ events: [] });
  },

  clearOlderThan: (ms) => {
    const cutoff = Date.now() - ms;
    const next = get().events.filter((e) => e.timestamp > cutoff);
    saveToStorage(next);
    set({ events: next });
  },
}));
