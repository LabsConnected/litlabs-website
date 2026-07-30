/**
 * useStudioProjectStore — canonical project selection state.
 *
 * Selection priority:
 * 1. Valid ?project= URL param
 * 2. Existing canonical store selection
 * 3. Server current-project response (via /api/capabilities)
 * 4. localStorage cache
 * 5. null
 *
 * Server remains authoritative. This store is the client-side cache
 * that syncs with URL and server responses.
 */

import { create } from "zustand";

const STORAGE_KEY = "litt:active-project-id";

interface StudioProjectState {
  currentProjectId: string | null;
  loading: boolean;
  error: string | null;
  selectProject: (id: string | null) => void;
  clearProject: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useStudioProjectStore = create<StudioProjectState>((set) => ({
  currentProjectId: getInitialProjectId(),
  loading: false,
  error: null,
  selectProject: (id) => {
    if (id) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    set({ currentProjectId: id, error: null });
  },
  clearProject: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    set({ currentProjectId: null, error: null });
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

function getInitialProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("project");
    if (fromUrl) return fromUrl;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
