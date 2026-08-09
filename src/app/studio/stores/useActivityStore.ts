"use client";

import { create } from "zustand";

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
