"use client";

/**
 * DraggableWidgetGrid — drag-and-drop widget grid powered by react-grid-layout.
 *
 * Features:
 * - Drag widgets to reposition
 * - Resize widgets by dragging corners
 * - Add/remove widgets from the library
 * - Layout persists to localStorage via zustand
 * - Preset layouts (Mission Control, Creator, Developer, Minimal)
 * - Edit mode toggle (drag/resize only when editing)
 * - Responsive breakpoints (lg, md, sm)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Responsive, useContainerWidth, verticalCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import {
  useDragLayoutStore,
  getAllPresets,
  getWidgetDef,
  type WidgetLayout,
} from "@/lib/dashboard/drag-layout-store";
import {
  WIDGET_DEFINITIONS,
} from "@/lib/dashboard/widget-registry";
import {
  LiTTQuickAskWidget,
  MissionQueueWidget,
  CurrentProjectWidget,
  ProjectRuntimeWidget,
  PendingApprovalsWidget,
  RecentActivityWidget,
  RecentCreationsWidget,
  MyGalleryWidget,
  TrendingGalleryWidget,
  DiscoverFeedWidget,
  MusicPlayerWidget,
  LiTTBitsWidget,
  NotificationsWidget,
  DeploymentsWidget,
  SavedItemsWidget,
  OwnerMetricWidget,
  SystemHealthWidget,
  AuditEventsWidget,
} from "@/components/dashboard/widgets/DashboardWidgets";
import { Icon } from "@/components/dashboard/v2/dashboard-v2-utils";
import { D } from "@/lib/dashboard/tokens";
import { useDashboardTheme } from "@/lib/dashboard/theme-store";
import type { MissionControlResponse } from "@/lib/mission-control";
import type { GalleryWidgetData } from "@/lib/dashboard/gallery-widget-data";
import type { DiscoverFeedItem } from "@/lib/dashboard/discover-widget-data";
import type { RecentCreation } from "@/lib/dashboard/recent-creations";

// ── Design tokens (theme-aware via CSS variables) ──────────────────

// ── Breakpoints (must match Tailwind) ──────────────────────────────

const BREAKPOINTS = { lg: 1200, md: 768, sm: 0 };
const COLS = { lg: 12, md: 10, sm: 1 };
const ROW_HEIGHT = 60;

// ── Props ──────────────────────────────────────────────────────────

interface DraggableWidgetGridProps {
  data: MissionControlResponse | null;
  widgetData: {
    recentCreations?: RecentCreation[];
    gallery?: GalleryWidgetData;
    discoverFeed?: DiscoverFeedItem[];
  };
  ownerMode: boolean;
}

// ── Component ──────────────────────────────────────────────────────

export function DraggableWidgetGrid({
  data,
  widgetData,
  ownerMode,
}: DraggableWidgetGridProps) {
  const {
    layouts,
    enabledWidgets,
    editMode,
    activePreset,
    customPresets,
    setAllLayouts,
    toggleWidget,
    setEditMode,
    applyPreset,
    resetToDefault,
    removeWidget,
    saveCustomPreset,
    deleteCustomPreset,
  } = useDragLayoutStore();

  const { theme, toggleTheme } = useDashboardTheme();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");
  const initialized = useRef(false);

  // Keyboard shortcuts: Ctrl+K = open widget library, Ctrl+E = toggle edit mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setDrawerOpen((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        setEditMode(!useDragLayoutStore.getState().editMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setEditMode]);

  const allPresets = useMemo(() => getAllPresets(customPresets), [customPresets]);

  // Initialize on first mount
  useEffect(() => {
    setMounted(true);
    if (!initialized.current && enabledWidgets.length === 0) {
      initialized.current = true;
      resetToDefault(ownerMode);
    }
  }, [enabledWidgets.length, ownerMode, resetToDefault]);

  // Filter enabled widgets by owner mode
  const visibleWidgets = useMemo(() => {
    return enabledWidgets.filter((id) => {
      const def = getWidgetDef(id);
      if (!def) return false;
      if (def.category === "owner" && !ownerMode) return false;
      return true;
    });
  }, [enabledWidgets, ownerMode]);

  // Check if a widget has data to show
  const hasData = useCallback(
    (widgetId: string): boolean => {
      switch (widgetId) {
        case "litt-quick-ask": return true;
        case "mission-queue": return (data?.missions ?? []).length > 0;
        case "current-project": return !!data?.project;
        case "project-runtime": return !!data?.project;
        case "pending-approvals": return (data?.missions ?? []).some(m => m.state === "awaiting_approval");
        case "recent-activity": return (data?.activity ?? []).length > 0;
        case "recent-creations": return (widgetData.recentCreations ?? []).length > 0;
        case "my-gallery": return (widgetData.gallery?.myGallery ?? []).length > 0;
        case "trending-gallery": return (widgetData.gallery?.trending ?? []).length > 0;
        case "discover-feed": return (widgetData.discoverFeed ?? []).length > 0;
        case "music-player": return true;
        case "littbits": return (data?.billing.balance ?? 0) > 0;
        case "system-health": return true;
        case "visitors-online": return ownerMode && (data?.growth?.visitorsOnline ?? 0) > 0;
        case "signed-in-online": return ownerMode && (data?.growth?.signedInOnline ?? 0) > 0;
        case "signups-today": return ownerMode && (data?.growth?.signupsToday ?? 0) > 0;
        case "studio-opens": return ownerMode && (data?.growth?.studioOpensToday ?? 0) > 0;
        case "first-prompts": return ownerMode && (data?.growth?.firstPromptsToday ?? 0) > 0;
        case "upgrades": return ownerMode && (data?.growth?.upgradesToday ?? 0) > 0;
        case "revenue": return ownerMode && (data?.billing.revenueTodayCents ?? 0) > 0;
        case "provider-costs": return ownerMode && (data?.billing.estimatedProviderCostTodayCents ?? 0) > 0;
        case "notifications": return false;
        case "deployments": return false;
        case "saved-items": return false;
        case "audit-events": return false;
        case "failed-tools": return false;
        case "failed-jobs": return false;
        case "terminal-sessions": return false;
        case "litt-live-sessions": return false;
        case "marketplace-installs": return false;
        default: return false;
      }
    },
    [data, widgetData, ownerMode],
  );

  // Render individual widget content
  const renderWidgetContent = (widgetId: string) => {
    const commonProps = { collapsed: false, onRemove: editMode ? () => removeWidget(widgetId) : undefined };
    switch (widgetId) {
      case "litt-quick-ask": return <LiTTQuickAskWidget {...commonProps} />;
      case "mission-queue": return <MissionQueueWidget {...commonProps} data={data} />;
      case "current-project": return <CurrentProjectWidget {...commonProps} data={data} />;
      case "project-runtime": return <ProjectRuntimeWidget {...commonProps} data={data} />;
      case "pending-approvals": return <PendingApprovalsWidget {...commonProps} data={data} />;
      case "recent-activity": return <RecentActivityWidget {...commonProps} data={data} />;
      case "recent-creations": return <RecentCreationsWidget {...commonProps} creations={widgetData.recentCreations ?? []} />;
      case "my-gallery": return <MyGalleryWidget {...commonProps} items={widgetData.gallery?.myGallery ?? []} />;
      case "trending-gallery": return <TrendingGalleryWidget {...commonProps} items={widgetData.gallery?.trending ?? []} />;
      case "discover-feed": return <DiscoverFeedWidget {...commonProps} posts={widgetData.discoverFeed ?? []} />;
      case "music-player": return <MusicPlayerWidget {...commonProps} />;
      case "littbits": return <LiTTBitsWidget {...commonProps} data={data} />;
      case "notifications": return <NotificationsWidget {...commonProps} />;
      case "deployments": return <DeploymentsWidget {...commonProps} />;
      case "saved-items": return <SavedItemsWidget {...commonProps} />;
      case "visitors-online": return <OwnerMetricWidget {...commonProps} title="Visitors Online" icon="eye" value={data?.growth?.visitorsOnline ?? 0} />;
      case "signed-in-online": return <OwnerMetricWidget {...commonProps} title="Signed-in Users" icon="users" value={data?.growth?.signedInOnline ?? 0} />;
      case "signups-today": return <OwnerMetricWidget {...commonProps} title="Signups Today" icon="user-plus" value={data?.growth?.signupsToday ?? 0} />;
      case "studio-opens": return <OwnerMetricWidget {...commonProps} title="Studio Opens" icon="sparkles" value={data?.growth?.studioOpensToday ?? 0} />;
      case "first-prompts": return <OwnerMetricWidget {...commonProps} title="First Prompts" icon="message" value={data?.growth?.firstPromptsToday ?? 0} />;
      case "upgrades": return <OwnerMetricWidget {...commonProps} title="Upgrades" icon="trending" value={data?.growth?.upgradesToday ?? 0} />;
      case "revenue": return <OwnerMetricWidget {...commonProps} title="Revenue" icon="dollar" value={`$${((data?.billing.revenueTodayCents ?? 0) / 100).toFixed(2)}`} detail="today" />;
      case "provider-costs": return <OwnerMetricWidget {...commonProps} title="Provider Costs" icon="cpu" value={`$${((data?.billing.estimatedProviderCostTodayCents ?? 0) / 100).toFixed(2)}`} detail="est. today" />;
      case "failed-tools": return <OwnerMetricWidget {...commonProps} title="Failed Tools" icon="alert" value="—" />;
      case "failed-jobs": return <OwnerMetricWidget {...commonProps} title="Failed Jobs" icon="alert" value="—" />;
      case "terminal-sessions": return <OwnerMetricWidget {...commonProps} title="Terminal Sessions" icon="terminal" value="—" />;
      case "litt-live-sessions": return <OwnerMetricWidget {...commonProps} title="LiTT Live Sessions" icon="bot" value="—" />;
      case "marketplace-installs": return <OwnerMetricWidget {...commonProps} title="Marketplace Installs" icon="shopping" value="—" />;
      case "system-health": return <SystemHealthWidget {...commonProps} data={data} />;
      case "audit-events": return <AuditEventsWidget {...commonProps} />;
      default: return null;
    }
  };

  // Build the current layout for RGL (only visible + has-data widgets)
  const currentLayouts = useMemo(() => {
    const result: Partial<Record<"lg" | "md" | "sm", WidgetLayout>> = {};
    for (const bp of ["lg", "md", "sm"] as const) {
      const stored = (layouts[bp] ?? []) as WidgetLayout;
      // Filter to only widgets that are visible AND have data
      result[bp] = stored.filter(
        (l: LayoutItem) => visibleWidgets.includes(l.i) && hasData(l.i),
      );
    }
    return result;
  }, [layouts, visibleWidgets, hasData]);

  // Handle layout change
  const handleLayoutChange = useCallback(
    (currentLayout: Layout, allLayouts: Partial<Record<"lg" | "md" | "sm", Layout>>) => {
      if (!editMode) return; // Only save when in edit mode
      // Cast readonly Layout to mutable WidgetLayout for the store
      const mutable = Object.fromEntries(
        Object.entries(allLayouts).map(([bp, layout]) => [
          bp,
          Array.from(layout ?? []),
        ]),
      ) as Partial<Record<"lg" | "md" | "sm", WidgetLayout>>;
      setAllLayouts(mutable);
    },
    [editMode, setAllLayouts],
  );

  // Container width measurement for responsive RGL
  const { width: containerWidth, containerRef } = useContainerWidth();

  if (!mounted) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl border" style={{ borderColor: D.border, background: D.surface }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* === Control bar === */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: D.textDim }}>
            Widgets
          </h2>
          <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: D.border, color: D.textMuted }}>
            {visibleWidgets.filter(hasData).length} active
          </span>
          {activePreset && activePreset !== "custom" && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: `${D.accent}40`, background: `${D.accent}10`, color: D.accent }}>
              {allPresets.find(p => p.id === activePreset)?.name ?? activePreset}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Preset selector */}
          <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: D.border }}>
            {allPresets.map((preset) => {
              const isCustom = preset.id.startsWith("custom-");
              return (
                <div key={preset.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => applyPreset(preset.id, ownerMode)}
                    className="rounded-md px-2.5 py-1.5 text-[10px] font-bold transition"
                    style={{
                      background: activePreset === preset.id ? `${D.accent}20` : "transparent",
                      color: activePreset === preset.id ? D.accent : D.textMuted,
                    }}
                    title={preset.description}
                  >
                    {preset.name}
                  </button>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => deleteCustomPreset(preset.id)}
                      className="ml-0.5 rounded p-0.5 transition hover:bg-red-500/20"
                      style={{ color: D.textDim }}
                      title="Delete preset"
                      aria-label={`Delete ${preset.name} preset`}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Save current layout as preset */}
          {showSaveDialog ? (
            <div className="flex items-center gap-1.5 rounded-lg border px-2 py-1" style={{ borderColor: D.border }}>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && presetName.trim()) {
                    saveCustomPreset(presetName.trim());
                    setPresetName("");
                    setShowSaveDialog(false);
                  }
                  if (e.key === "Escape") {
                    setPresetName("");
                    setShowSaveDialog(false);
                  }
                }}
                placeholder="Preset name..."
                autoFocus
                className="w-28 bg-transparent text-[10px] font-bold outline-none"
                style={{ color: D.textPrimary }}
              />
              <button
                type="button"
                onClick={() => {
                  if (presetName.trim()) {
                    saveCustomPreset(presetName.trim());
                    setPresetName("");
                    setShowSaveDialog(false);
                  }
                }}
                className="rounded px-2 py-1 text-[10px] font-black"
                style={{ background: D.accent, color: D.textOnAccent }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setPresetName(""); setShowSaveDialog(false); }}
                className="rounded px-1.5 py-1 text-[10px] font-bold"
                style={{ color: D.textMuted }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSaveDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:opacity-80"
              style={{ borderColor: D.border, color: D.textMuted }}
              title="Save current layout as a custom preset"
            >
              <Icon name="bookmark" size={12} />
              Save Layout
            </button>
          )}

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition"
            style={{
              borderColor: theme === "light" ? `${D.accentAmber}40` : D.border,
              background: theme === "light" ? `${D.accentAmber}10` : "transparent",
              color: theme === "light" ? D.accentAmber : D.textMuted,
            }}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <Icon name={theme === "light" ? "moon" : "sun"} size={12} />
            {theme === "light" ? "Dark" : "Light"}
          </button>

          {/* Edit mode toggle */}
          <button
            type="button"
            onClick={() => setEditMode(!editMode)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition"
            style={{
              borderColor: editMode ? `${D.accentGreen}40` : D.border,
              background: editMode ? `${D.accentGreen}10` : "transparent",
              color: editMode ? D.accentGreen : D.textMuted,
            }}
          >
            <Icon name={editMode ? "check" : "settings"} size={12} />
            {editMode ? "Done Editing" : "Edit Layout"}
          </button>

          {/* Add widget */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition"
            style={{ borderColor: `${D.accent}40`, background: `${D.accent}10`, color: D.accent }}
          >
            <Icon name="plus" size={12} />
            Add Widget
          </button>
        </div>
      </div>

      {/* === Edit mode hint === */}
      {editMode && (
        <div
          className="mb-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs"
          style={{ borderColor: `${D.accentGreen}33`, background: `${D.accentGreen}08`, color: D.accentGreen }}
        >
          <Icon name="zap" size={13} />
          Edit mode is on — drag widgets to move them, drag the bottom-right corner to resize. Changes save automatically.
          <span className="ml-2 opacity-60">Ctrl+E to toggle, Ctrl+K for widget library</span>
        </div>
      )}

      {/* === Draggable grid === */}
      {visibleWidgets.filter(hasData).length > 0 ? (
        <div ref={containerRef} className={editMode ? "rgl-editing" : ""}>
          <Responsive
            className="layout"
            cols={COLS}
            breakpoints={BREAKPOINTS}
            rowHeight={ROW_HEIGHT}
            width={containerWidth}
            layouts={currentLayouts}
            onLayoutChange={handleLayoutChange}
            dragConfig={{ enabled: editMode, bounded: false, threshold: 3, cancel: ".widget-no-drag" }}
            resizeConfig={{ enabled: editMode, handles: ["se"] }}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            compactor={verticalCompactor}
          >
            {visibleWidgets.filter(hasData).map((widgetId) => {
              return (
                <div
                  key={widgetId}
                  className="rgl-widget-wrapper"
                  style={{
                    borderRadius: 16,
                    overflow: "hidden",
                  }}
                >
                  {renderWidgetContent(widgetId)}
                  {editMode && (
                    <div
                      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-black"
                      style={{
                        background: D.overlay,
                        borderColor: D.border,
                        color: D.textMuted,
                        cursor: "default",
                      }}
                    >
                      <Icon name="drag" size={10} />
                      DRAG
                    </div>
                  )}
                </div>
              );
            })}
          </Responsive>
        </div>
      ) : (
        /* Empty state */
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: D.surface, borderColor: D.border }}
        >
          <div className="text-sm font-bold" style={{ color: D.textMuted }}>
            No widget data yet
          </div>
          <p className="mt-2 text-xs" style={{ color: D.textDim }}>
            Connect a project, start a mission, or create something in the Studio to see live data here.
          </p>
          <Link
            href="/studio?tool=chat"
            className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black"
            style={{ background: D.accent, color: D.textOnAccent }}
          >
            <Icon name="sparkles" size={14} />
            Start in Studio
          </Link>
        </div>
      )}

      {/* === Widget Library Drawer === */}
      <WidgetLibraryDrawerV2
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        enabledWidgets={visibleWidgets}
        ownerMode={ownerMode}
        onToggle={toggleWidget}
        onReset={() => resetToDefault(ownerMode)}
      />
    </div>
  );
}

// ── Widget Library Drawer V2 ───────────────────────────────────────

function WidgetLibraryDrawerV2({
  open,
  onClose,
  enabledWidgets,
  ownerMode,
  onToggle,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  enabledWidgets: string[];
  ownerMode: boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset search when drawer closes
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (!open) return null;

  const searchLower = search.trim().toLowerCase();
  const matches = (w: typeof WIDGET_DEFINITIONS[number]) =>
    !searchLower ||
    w.label.toLowerCase().includes(searchLower) ||
    w.description.toLowerCase().includes(searchLower);

  const userWidgets = WIDGET_DEFINITIONS.filter((w) => w.category === "user" && matches(w));
  const ownerWidgets = WIDGET_DEFINITIONS.filter((w) => w.category === "owner" && matches(w));
  const totalCount = userWidgets.length + ownerWidgets.length;

  const renderWidget = (w: typeof WIDGET_DEFINITIONS[number]) => {
    const added = enabledWidgets.includes(w.id);
    return (
      <div
        key={w.id}
        className="flex items-center justify-between gap-3 rounded-xl border p-3"
        style={{ borderColor: D.border, background: D.surface }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${D.accent}15` }}>
            <Icon name={w.icon} size={14} style={{ color: D.accent }} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold" style={{ color: D.textPrimary }}>{w.label}</div>
            <div className="truncate text-[10px]" style={{ color: D.textMuted }}>{w.description}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(w.id)}
          className="shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black transition"
          style={
            added
              ? { background: `${D.accentRed}1a`, color: D.dangerText, border: `1px solid ${D.accentRed}33` }
              : { background: D.accent, color: D.textOnAccent }
          }
        >
          {added ? "Remove" : "Add"}
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[300] flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative flex h-full w-full max-w-md flex-col border-l"
        style={{ background: D.surfaceSolid, borderColor: D.border }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: D.border }}>
          <div>
            <div className="text-sm font-black" style={{ color: D.textPrimary }}>Widget Library</div>
            <div className="text-[10px]" style={{ color: D.textMuted }}>Add and remove widgets from your dashboard</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/10"
            style={{ color: D.textMuted }}
            aria-label="Close widget library"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-5 py-3">
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: D.border, background: D.surface }}>
            <Icon name="search" size={14} style={{ color: D.textMuted }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search widgets..."
              className="flex-1 bg-transparent text-xs font-medium outline-none"
              style={{ color: D.textPrimary }}
              aria-label="Search widgets"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="rounded p-0.5 transition hover:bg-white/10"
                style={{ color: D.textMuted }}
                aria-label="Clear search"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Reset */}
        <div className="shrink-0 px-5 pb-3">
          <button
            type="button"
            onClick={onReset}
            className="w-full rounded-xl border px-3 py-2.5 text-[11px] font-bold transition hover:bg-white/5"
            style={{ borderColor: D.border, color: D.textMuted }}
          >
            Reset to Default Layout
          </button>
        </div>

        {/* Widget list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {totalCount === 0 ? (
            <div className="py-8 text-center">
              <Icon name="search" size={20} className="mx-auto" style={{ color: D.textDim }} />
              <div className="mt-3 text-xs font-bold" style={{ color: D.textMuted }}>
                No widgets match &ldquo;{search}&rdquo;
              </div>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="mt-2 text-[10px] font-bold transition hover:opacity-80"
                style={{ color: D.accent }}
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em]" style={{ color: D.textDim }}>
                Your Widgets {userWidgets.length > 0 && `(${userWidgets.length})`}
              </div>
              <div className="space-y-2">
                {userWidgets.map(renderWidget)}
              </div>

              {ownerMode && ownerWidgets.length > 0 && (
                <>
                  <div className="mb-2 mt-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em]" style={{ color: D.accentAmber }}>
                    <Icon name="shield" size={11} />
                    Owner-Only Widgets ({ownerWidgets.length})
                  </div>
                  <div className="space-y-2">
                    {ownerWidgets.map(renderWidget)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
