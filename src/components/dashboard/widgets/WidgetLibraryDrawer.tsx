"use client";

/**
 * Widget Library Drawer — opens from the Customize button.
 * Shows all available widgets (user + owner) with add/remove toggles.
 */

import { useEffect, useRef } from "react";
import { Icon } from "../../dashboard/v2/dashboard-v2-utils";
import {
  WIDGET_DEFINITIONS,
  type WidgetDefinition,
  type DashboardWidgetPlacement,
} from "@/lib/dashboard/widget-registry";

const D = {
  surface: "rgba(255,255,255,0.025)",
  border: "rgba(168,85,247,0.12)",
  accent: "#a970ff",
  accentAmber: "#F97316",
  textPrimary: "#eef4ff",
  textMuted: "rgba(238,244,255,0.45)",
  textDim: "rgba(238,244,255,0.25)",
};

export function WidgetLibraryDrawer({
  open,
  onClose,
  placements,
  ownerMode,
  onAdd,
  onRemove,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  placements: DashboardWidgetPlacement[];
  ownerMode: boolean;
  onAdd: (widgetId: string) => void;
  onRemove: (widgetId: string) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const userWidgets = WIDGET_DEFINITIONS.filter((w) => w.category === "user");
  const ownerWidgets = WIDGET_DEFINITIONS.filter((w) => w.category === "owner");

  const isAdded = (id: string) => placements.some((p) => p.widgetId === id && !p.hidden);

  const renderWidget = (w: WidgetDefinition) => {
    const added = isAdded(w.id);
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
          onClick={() => (added ? onRemove(w.id) : onAdd(w.id))}
          className="shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black transition"
          style={
            added
              ? { background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }
              : { background: D.accent, color: "#fff" }
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
        ref={ref}
        className="relative flex h-full w-full max-w-md flex-col border-l"
        style={{ background: "#0a0b14", borderColor: D.border }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: D.border }}>
          <div>
            <div className="text-sm font-black" style={{ color: D.textPrimary }}>Customize Dashboard</div>
            <div className="text-[10px]" style={{ color: D.textMuted }}>Add, remove, and rearrange widgets</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg transition hover:bg-white/10"
            style={{ color: D.textMuted }}
            aria-label="Close customize panel"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Reset */}
        <div className="shrink-0 px-5 py-3">
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
          <div className="mb-2 text-[10px] font-black uppercase tracking-[.16em]" style={{ color: D.textDim }}>
            Your Widgets
          </div>
          <div className="space-y-2">
            {userWidgets.map(renderWidget)}
          </div>

          {ownerMode && (
            <>
              <div className="mb-2 mt-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em]" style={{ color: D.accentAmber }}>
                <Icon name="shield" size={11} />
                Owner-Only Widgets
              </div>
              <div className="space-y-2">
                {ownerWidgets.map(renderWidget)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
