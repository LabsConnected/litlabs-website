"use client";

/**
 * Dashboard theme store — light/dark mode for the dashboard surface.
 *
 * Uses zustand + persist for instant localStorage sync.
 * Applies theme by setting `data-dashboard-theme` on <html>.
 * Scoped to dashboard so the rest of the app keeps its cinematic dark look.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DashboardTheme = "dark" | "light";

interface ThemeState {
  theme: DashboardTheme;
  toggleTheme: () => void;
  setTheme: (theme: DashboardTheme) => void;
}

export const useDashboardTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark",
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "litt-dashboard-theme",
    },
  ),
);
