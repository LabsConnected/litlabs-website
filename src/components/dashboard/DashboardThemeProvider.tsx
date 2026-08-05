"use client";

/**
 * DashboardThemeProvider — applies the dashboard theme to <html>.
 *
 * Sets `data-dashboard-theme="light|dark"` so CSS can scope overrides.
 * Scoped to dashboard surfaces only — the rest of the app stays dark.
 */

import { useEffect } from "react";
import { useDashboardTheme } from "@/lib/dashboard/theme-store";

export function DashboardThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useDashboardTheme((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-dashboard-theme", theme);
  }, [theme]);

  return <>{children}</>;
}
