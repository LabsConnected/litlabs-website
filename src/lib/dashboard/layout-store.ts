"use client";

/**
 * Dashboard layout store — persists widget placements per user + breakpoint.
 *
 * Uses localStorage for instant load + API sync for cross-device persistence.
 * Widget CONTENT always comes from canonical APIs, never from localStorage.
 */

import { useCallback, useEffect, useState } from "react";
import {
  type DashboardLayout,
  type DashboardWidgetPlacement,
  detectBreakpoint,
  getDefaultLayout,
} from "./widget-registry";

const STORAGE_KEY = "litt-dashboard-layout";

interface StoredLayout {
  layouts: Partial<Record<"desktop" | "tablet" | "mobile", DashboardWidgetPlacement[]>>;
  ownerMode: boolean;
}

function loadFromStorage(userId: string): StoredLayout | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as StoredLayout;
  } catch {
    return null;
  }
}

function saveToStorage(userId: string, layout: StoredLayout) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(layout));
  } catch {
    // Non-fatal — localStorage may be full or disabled
  }
}

export function useDashboardLayout(userId: string, ownerMode: boolean) {
  const [breakpoint, setBreakpoint] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [placements, setPlacements] = useState<DashboardWidgetPlacement[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Detect breakpoint
  useEffect(() => {
    const update = () => setBreakpoint(detectBreakpoint());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Load layout on mount
  useEffect(() => {
    if (!userId) return;
    const stored = loadFromStorage(userId);
    if (stored && stored.layouts[breakpoint]) {
      // Filter placements by owner mode — non-owners can't see owner widgets
      const defs = ownerMode
        ? stored.layouts[breakpoint]!
        : stored.layouts[breakpoint]!.filter((p) => !isOwnerWidget(p.widgetId));
      setPlacements(defs);
    } else {
      setPlacements(getDefaultLayout(ownerMode));
    }
    setLoaded(true);
  }, [userId, breakpoint, ownerMode]);

  // Save to storage whenever placements change
  const saveLayout = useCallback((newPlacements: DashboardWidgetPlacement[]) => {
    if (!userId) return;
    const stored = loadFromStorage(userId) ?? { layouts: {}, ownerMode };
    stored.layouts[breakpoint] = newPlacements;
    stored.ownerMode = ownerMode;
    saveToStorage(userId, stored);

    // Fire-and-forget API sync for cross-device persistence
    void fetch("/api/dashboard/layout", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        breakpoint,
        placements: newPlacements,
      } satisfies Omit<DashboardLayout, "userId" | "updatedAt">),
    }).catch(() => {
      // Non-fatal — localStorage is the primary store
    });
  }, [userId, breakpoint, ownerMode]);

  const updatePlacement = useCallback((widgetId: string, patch: Partial<DashboardWidgetPlacement>) => {
    setPlacements((prev) => {
      const next = prev.map((p) =>
        p.widgetId === widgetId ? { ...p, ...patch } : p,
      );
      saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  const toggleCollapsed = useCallback((widgetId: string) => {
    setPlacements((prev) => {
      const next = prev.map((p) =>
        p.widgetId === widgetId ? { ...p, collapsed: !p.collapsed } : p,
      );
      saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  const toggleHidden = useCallback((widgetId: string) => {
    setPlacements((prev) => {
      const next = prev.map((p) =>
        p.widgetId === widgetId ? { ...p, hidden: !p.hidden } : p,
      );
      saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  const addWidget = useCallback((widgetId: string) => {
    setPlacements((prev) => {
      if (prev.some((p) => p.widgetId === widgetId)) return prev;
      const next = [...prev, {
        widgetId,
        x: 0,
        y: Math.max(0, ...prev.map((p) => p.y + p.height)),
        width: 6,
        height: 3,
        collapsed: false,
        hidden: false,
      }];
      saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  const removeWidget = useCallback((widgetId: string) => {
    setPlacements((prev) => {
      const next = prev.map((p) =>
        p.widgetId === widgetId ? { ...p, hidden: true } : p,
      );
      saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  const resetLayout = useCallback(() => {
    const defaults = getDefaultLayout(ownerMode);
    setPlacements(defaults);
    saveLayout(defaults);
  }, [ownerMode, saveLayout]);

  const moveWidget = useCallback((widgetId: string, direction: "up" | "down") => {
    setPlacements((prev) => {
      const idx = prev.findIndex((p) => p.widgetId === widgetId);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      saveLayout(next);
      return next;
    });
  }, [saveLayout]);

  return {
    placements,
    breakpoint,
    loaded,
    updatePlacement,
    toggleCollapsed,
    toggleHidden,
    addWidget,
    removeWidget,
    resetLayout,
    moveWidget,
  };
}

function isOwnerWidget(widgetId: string): boolean {
  // Owner widgets are defined in the registry with category "owner"
  // We check by ID prefix for efficiency
  const ownerIds = [
    "visitors-online", "signed-in-online", "signups-today", "studio-opens",
    "first-prompts", "upgrades", "revenue", "provider-costs",
    "failed-tools", "failed-jobs", "terminal-sessions", "litt-live-sessions",
    "marketplace-installs", "system-health", "audit-events",
  ];
  return ownerIds.includes(widgetId);
}
