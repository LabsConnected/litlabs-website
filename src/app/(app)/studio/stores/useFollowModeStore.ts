"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Follow LiTT mode store — contract §2.2 ("Follow LiTT Toggle").
 *
 * - ON:  LiTT changes the visible station as it works (the workspace
 *        follows LiTT's active station).
 * - OFF: LiTT keeps executing elsewhere; the user gets a
 *        "LiTT is working in X / [Show me]" notification instead of
 *        being auto-navigated.
 *
 * Persisted under the exact contract key so the preference survives
 * reloads. Read hook-free via `useFollowModeStore.getState()` from
 * `follow-navigation.ts` (the agent loop has no React context).
 *
 * `FollowMode` / `FOLLOW_MODE_STORAGE_KEY` are owned by chunk A
 * (`src/lib/station-control/types.ts`); this module imports and
 * re-exports them (no local redeclaration — single source of truth).
 */

import { FOLLOW_MODE_STORAGE_KEY } from "@/lib/station-control/types";
import type { FollowMode } from "@/lib/station-control/types";

export { FOLLOW_MODE_STORAGE_KEY };

interface FollowModeStore {
  mode: FollowMode;
  setMode: (mode: FollowMode) => void;
}

export const useFollowModeStore = create<FollowModeStore>()(
  persist(
    (set) => ({
      mode: "on",
      // Coerce garbage to "on" — the store must never hold an
      // invalid mode (corrupt storage, stray callers).
      setMode: (mode) => set({ mode: mode === "off" ? "off" : "on" }),
    }),
    {
      name: FOLLOW_MODE_STORAGE_KEY,
      // Coerce corrupted/legacy persisted values back to a valid mode.
      merge: (persisted, current) => ({
        ...current,
        ...((typeof persisted === "object" && persisted !== null ? persisted : {}) as object),
        mode:
          (persisted as { mode?: unknown } | null)?.mode === "off" ? "off" : "on",
      }),
    },
  ),
);
