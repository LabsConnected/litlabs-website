"use client";

/**
 * Drag layout store — powers the draggable widget grid.
 *
 * Uses zustand + persist for instant localStorage sync.
 * Stores react-grid-layout Layout[] per breakpoint.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LayoutItem } from "react-grid-layout";
import {
  WIDGET_DEFINITIONS,
  type WidgetDefinition,
} from "./widget-registry";

// ── Types ──────────────────────────────────────────────────────────

export type Breakpoint = "lg" | "md" | "sm";

/** A layout is an array of layout items (mutable version of RGL's Layout) */
export type WidgetLayout = LayoutItem[];

export interface DragLayoutState {
  layouts: Partial<Record<Breakpoint, WidgetLayout>>;
  enabledWidgets: string[];
  editMode: boolean;
  activePreset: string | null;
  customPresets: DashboardPreset[];
}

export interface DragLayoutActions {
  setLayout: (bp: Breakpoint, layout: WidgetLayout) => void;
  setAllLayouts: (layouts: Partial<Record<Breakpoint, WidgetLayout>>) => void;
  addWidget: (widgetId: string) => void;
  removeWidget: (widgetId: string) => void;
  toggleWidget: (widgetId: string) => void;
  setEditMode: (on: boolean) => void;
  applyPreset: (presetId: string, ownerMode: boolean) => void;
  resetToDefault: (ownerMode: boolean) => void;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (presetId: string) => void;
}

// ── Presets ────────────────────────────────────────────────────────

export interface DashboardPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Widget IDs to enable */
  widgets: string[];
  /** Layout for lg breakpoint (12-col grid) */
  lgLayout: Pick<LayoutItem, "i" | "x" | "y" | "w" | "h" | "minW" | "minH">[];
}

export const DASHBOARD_PRESETS: DashboardPreset[] = [
  {
    id: "mission-control",
    name: "Mission Control",
    description: "Default — missions, project, and activity focus",
    icon: "zap",
    widgets: [
      "litt-quick-ask",
      "mission-queue",
      "current-project",
      "project-runtime",
      "recent-activity",
      "pending-approvals",
      "system-health",
      "music-player",
    ],
    lgLayout: [
      { i: "current-project", x: 0, y: 0, w: 6, h: 3, minW: 4, minH: 2 },
      { i: "litt-quick-ask", x: 6, y: 0, w: 6, h: 3, minW: 4, minH: 2 },
      { i: "mission-queue", x: 0, y: 3, w: 8, h: 5, minW: 4, minH: 3 },
      { i: "pending-approvals", x: 8, y: 3, w: 4, h: 3, minW: 3, minH: 2 },
      { i: "project-runtime", x: 8, y: 6, w: 4, h: 4, minW: 3, minH: 2 },
      { i: "recent-activity", x: 0, y: 8, w: 8, h: 5, minW: 4, minH: 3 },
      { i: "system-health", x: 8, y: 10, w: 4, h: 4, minW: 3, minH: 2 },
      { i: "music-player", x: 0, y: 13, w: 12, h: 3, minW: 4, minH: 2 },
    ],
  },
  {
    id: "creator",
    name: "Creator",
    description: "Gallery, creations, and media focus",
    icon: "sparkles",
    widgets: [
      "litt-quick-ask",
      "recent-creations",
      "my-gallery",
      "trending-gallery",
      "discover-feed",
      "music-player",
      "littbits",
    ],
    lgLayout: [
      { i: "litt-quick-ask", x: 0, y: 0, w: 12, h: 3, minW: 4, minH: 2 },
      { i: "recent-creations", x: 0, y: 3, w: 6, h: 5, minW: 4, minH: 3 },
      { i: "my-gallery", x: 6, y: 3, w: 6, h: 5, minW: 4, minH: 3 },
      { i: "trending-gallery", x: 0, y: 8, w: 6, h: 5, minW: 4, minH: 3 },
      { i: "discover-feed", x: 6, y: 8, w: 6, h: 5, minW: 4, minH: 3 },
      { i: "music-player", x: 0, y: 13, w: 8, h: 3, minW: 4, minH: 2 },
      { i: "littbits", x: 8, y: 13, w: 4, h: 3, minW: 2, minH: 2 },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    description: "Project runtime, deployments, and code focus",
    icon: "code",
    widgets: [
      "litt-quick-ask",
      "current-project",
      "project-runtime",
      "mission-queue",
      "deployments",
      "recent-activity",
      "pending-approvals",
      "system-health",
    ],
    lgLayout: [
      { i: "current-project", x: 0, y: 0, w: 6, h: 3, minW: 4, minH: 2 },
      { i: "project-runtime", x: 6, y: 0, w: 6, h: 4, minW: 4, minH: 2 },
      { i: "litt-quick-ask", x: 0, y: 3, w: 6, h: 3, minW: 4, minH: 2 },
      { i: "pending-approvals", x: 6, y: 4, w: 6, h: 2, minW: 3, minH: 2 },
      { i: "mission-queue", x: 0, y: 6, w: 8, h: 5, minW: 4, minH: 3 },
      { i: "deployments", x: 8, y: 6, w: 4, h: 4, minW: 3, minH: 2 },
      { i: "recent-activity", x: 0, y: 11, w: 8, h: 4, minW: 4, minH: 3 },
      { i: "system-health", x: 8, y: 10, w: 4, h: 5, minW: 3, minH: 2 },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Just the essentials — clean and focused",
    icon: "layers",
    widgets: [
      "litt-quick-ask",
      "mission-queue",
      "recent-activity",
    ],
    lgLayout: [
      { i: "litt-quick-ask", x: 0, y: 0, w: 12, h: 3, minW: 4, minH: 2 },
      { i: "mission-queue", x: 0, y: 3, w: 7, h: 6, minW: 4, minH: 3 },
      { i: "recent-activity", x: 7, y: 3, w: 5, h: 6, minW: 4, minH: 3 },
    ],
  },
];

// ── Default layout ─────────────────────────────────────────────────

function getDefaultWidgets(ownerMode: boolean): string[] {
  const userWidgets = WIDGET_DEFINITIONS.filter((w) => w.category === "user").map((w) => w.id);
  const ownerWidgets = ownerMode
    ? WIDGET_DEFINITIONS.filter((w) => w.category === "owner").map((w) => w.id)
    : [];
  // Start with a sensible default set, not all widgets
  const defaultSet = [
    "litt-quick-ask",
    "mission-queue",
    "current-project",
    "project-runtime",
    "recent-activity",
    "pending-approvals",
    "system-health",
    "music-player",
  ];
  // Add owner widgets if owner mode
  if (ownerMode) {
    defaultSet.push("visitors-online", "signups-today", "revenue");
  }
  // Filter to only widgets that exist
  const all = [...userWidgets, ...ownerWidgets];
  return defaultSet.filter((id) => all.includes(id));
}

function buildLayoutFromWidgets(widgetIds: string[]): WidgetLayout {
  return widgetIds.map((id, idx) => {
    const def = WIDGET_DEFINITIONS.find((w) => w.id === id);
    if (!def) {
      return { i: id, x: (idx * 6) % 12, y: Math.floor(idx / 2) * 4, w: 6, h: 4, minW: 3, minH: 2 } as LayoutItem;
    }
    return {
      i: id,
      x: def.defaultPlacement.x,
      y: def.defaultPlacement.y,
      w: def.defaultPlacement.width,
      h: def.defaultPlacement.height,
      minW: def.minWidth,
      minH: def.minHeight,
    } as LayoutItem;
  });
}

// ── Store ──────────────────────────────────────────────────────────

export const useDragLayoutStore = create<DragLayoutState & DragLayoutActions>()(
  persist(
    (set) => ({
      layouts: {},
      enabledWidgets: [],
      editMode: false,
      activePreset: "mission-control",
      customPresets: [],

      setLayout: (bp, layout) =>
        set((s) => ({ layouts: { ...s.layouts, [bp]: layout }, activePreset: null })),

      setAllLayouts: (layouts) =>
        set((s) => ({ layouts: { ...s.layouts, ...layouts }, activePreset: null })),

      addWidget: (widgetId) =>
        set((s) => {
          if (s.enabledWidgets.includes(widgetId)) return s;
          const def = WIDGET_DEFINITIONS.find((w) => w.id === widgetId);
          const newWidget: LayoutItem = def
            ? {
                i: widgetId,
                x: def.defaultPlacement.x,
                y: 99, // place at bottom
                w: def.defaultPlacement.width,
                h: def.defaultPlacement.height,
                minW: def.minWidth,
                minH: def.minHeight,
              }
            : { i: widgetId, x: 0, y: 99, w: 6, h: 4, minW: 3, minH: 2 };

          const lgLayout: WidgetLayout = [...(s.layouts.lg ?? []), newWidget];
          return {
            enabledWidgets: [...s.enabledWidgets, widgetId],
            layouts: { ...s.layouts, lg: lgLayout },
            activePreset: null,
          };
        }),

      removeWidget: (widgetId) =>
        set((s) => ({
          enabledWidgets: s.enabledWidgets.filter((id) => id !== widgetId),
          layouts: Object.fromEntries(
            Object.entries(s.layouts).map(([bp, layout]) => [
              bp,
              (layout as WidgetLayout).filter((l: LayoutItem) => l.i !== widgetId),
            ]),
          ),
          activePreset: null,
        })),

      toggleWidget: (widgetId) =>
        set((s) => {
          if (s.enabledWidgets.includes(widgetId)) {
            return {
              enabledWidgets: s.enabledWidgets.filter((id) => id !== widgetId),
              layouts: Object.fromEntries(
                Object.entries(s.layouts).map(([bp, layout]) => [
                  bp,
                  (layout as WidgetLayout).filter((l: LayoutItem) => l.i !== widgetId),
                ]),
              ),
              activePreset: null,
            };
          }
          // Add
          const def = WIDGET_DEFINITIONS.find((w) => w.id === widgetId);
          const newWidget: LayoutItem = def
            ? { i: widgetId, x: def.defaultPlacement.x, y: 99, w: def.defaultPlacement.width, h: def.defaultPlacement.height, minW: def.minWidth, minH: def.minHeight }
            : { i: widgetId, x: 0, y: 99, w: 6, h: 4, minW: 3, minH: 2 };
          return {
            enabledWidgets: [...s.enabledWidgets, widgetId],
            layouts: { ...s.layouts, lg: [...(s.layouts.lg ?? []), newWidget] as WidgetLayout },
            activePreset: null,
          };
        }),

      setEditMode: (on) => set({ editMode: on }),

      applyPreset: (presetId, _ownerMode) =>
        set(() => {
          const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId);
          if (!preset) return {} as Partial<DragLayoutState & DragLayoutActions>;
          const lgLayout: WidgetLayout = preset.lgLayout.map((l) => ({ ...l } as LayoutItem));
          // Auto-generate md and sm from lg
          const mdLayout: WidgetLayout = lgLayout.map((l) => ({ ...l, w: Math.min(l.w, 10), x: Math.min(l.x, 2) } as LayoutItem));
          const smLayout: WidgetLayout = lgLayout.map((l) => ({ ...l, w: 12, x: 0 } as LayoutItem));
          return {
            enabledWidgets: [...preset.widgets],
            layouts: { lg: lgLayout, md: mdLayout, sm: smLayout },
            activePreset: presetId,
          };
        }),

      resetToDefault: (ownerMode) =>
        set(() => {
          const widgets = getDefaultWidgets(ownerMode);
          const lg = buildLayoutFromWidgets(widgets);
          const md: WidgetLayout = lg.map((l) => ({ ...l, w: Math.min(l.w, 10), x: Math.min(l.x, 2) } as LayoutItem));
          const sm: WidgetLayout = lg.map((l) => ({ ...l, w: 12, x: 0 } as LayoutItem));
          return {
            enabledWidgets: widgets,
            layouts: { lg, md, sm },
            activePreset: "mission-control",
          };
        }),

      saveCustomPreset: (name) =>
        set((s) => {
          const lg = s.layouts.lg ?? [];
          const id = `custom-${Date.now()}`;
          const preset: DashboardPreset = {
            id,
            name,
            description: "Your saved layout",
            icon: "bookmark",
            widgets: [...s.enabledWidgets],
            lgLayout: lg.map((l) => ({
              i: l.i, x: l.x, y: l.y, w: l.w, h: l.h,
              minW: l.minW, minH: l.minH,
            })),
          };
          return {
            customPresets: [...s.customPresets, preset],
            activePreset: id,
          };
        }),

      deleteCustomPreset: (presetId) =>
        set((s) => ({
          customPresets: s.customPresets.filter((p) => p.id !== presetId),
        })),
    }),
    {
      name: "litt-drag-layout",
      partialize: (s) => ({
        layouts: s.layouts,
        enabledWidgets: s.enabledWidgets,
        activePreset: s.activePreset,
        customPresets: s.customPresets,
      }),
    },
  ),
);

// ── Helpers ────────────────────────────────────────────────────────

export function getWidgetDef(id: string): WidgetDefinition | undefined {
  return WIDGET_DEFINITIONS.find((w) => w.id === id);
}

/** Get all presets (built-in + user-saved) for the selector UI */
export function getAllPresets(customPresets: DashboardPreset[]): DashboardPreset[] {
  return [...DASHBOARD_PRESETS, ...customPresets];
}

/** Initialize the store if it's empty (first load) */
export function initDragLayoutIfEmpty(ownerMode: boolean) {
  const state = useDragLayoutStore.getState();
  if (state.enabledWidgets.length === 0 && Object.keys(state.layouts).length === 0) {
    state.resetToDefault(ownerMode);
  }
}
