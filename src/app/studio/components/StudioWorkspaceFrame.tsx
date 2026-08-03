"use client";

import { useEffect } from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  PanelBottomClose,
  PanelBottomOpen,
  ClipboardList,
  GitPullRequest,
  CircleCheck,
  ShieldCheck,
  Activity,
  Terminal,
} from "lucide-react";
import type { InspectorTab, DrawerTab } from "../lib/studio-destinations";

/**
 * StudioWorkspaceFrame — collapsible right inspector + bottom drawer.
 *
 * Right inspector tabs: Plan | Changes | Checks | Approvals
 * Bottom drawer tabs:   Activity | Terminal
 *
 * Both start collapsed. When open, the inspector overlays content on
 * mobile and splits the layout on desktop. The drawer never covers the
 * composer (it sits above it with a max-height).
 *
 * Phase 1 only renders the frame + tab chrome. Tab content is a slot so
 * Phase 2 can wire real run data without touching this component.
 */

const INSPECTOR_TABS: { id: InspectorTab; label: string; icon: typeof ClipboardList }[] = [
  { id: "plan", label: "Plan", icon: ClipboardList },
  { id: "changes", label: "Changes", icon: GitPullRequest },
  { id: "checks", label: "Checks", icon: CircleCheck },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
];

const DRAWER_TABS: { id: DrawerTab; label: string; icon: typeof Activity }[] = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "terminal", label: "Terminal", icon: Terminal },
];

export function StudioInspector({
  open,
  onToggle,
  activeTab,
  onTabChange,
  children,
  width = 320,
  onWidthChange,
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  children?: React.ReactNode;
  width?: number;
  onWidthChange?: (w: number) => void;
}) {
  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(240, Math.min(600, startWidth - delta));
      onWidthChange?.(newWidth);
    };
    
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <>
      {/* Collapse/expand handle — always visible on desktop */}
      <button
        type="button"
        onClick={onToggle}
        className="hidden md:flex h-9 w-7 shrink-0 items-center justify-center border-l transition hover:bg-white/5"
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
          color: "var(--text-muted)",
        }}
        aria-label={open ? "Collapse inspector" : "Open inspector"}
        title={open ? "Collapse inspector" : "Open inspector"}
      >
        {open ? <PanelRightClose size={14} className="pointer-events-none" /> : <PanelRightOpen size={14} className="pointer-events-none" />}
      </button>

      {open && (
        <aside
          className="flex h-full min-w-0 flex-col border-l"
          style={{
            backgroundColor: "var(--studio-surface)",
            borderColor: "var(--studio-border)",
            width: `${width}px`,
          }}
        >
          {/* Resize handle — draggable left edge */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-litt-primary/30 transition"
            style={{ backgroundColor: "transparent" }}
            aria-label="Resize inspector width"
            title="Drag to resize"
          />
          <div
            className="flex shrink-0 items-center gap-0.5 border-b px-1.5"
            style={{ borderColor: "var(--studio-border)" }}
          >
            {INSPECTOR_TABS.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTabChange(t.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[10px] font-bold transition"
                  style={{
                    color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                    borderBottom: isActive ? "2px solid var(--litt-primary)" : "2px solid transparent",
                  }}
                  aria-label={t.label}
                >
                  <Icon size={12} className="pointer-events-none" />
                  <span className="hidden lg:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {children ?? (
              <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                No {activeTab} yet
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

export function StudioDrawer({
  open,
  onToggle,
  activeTab,
  onTabChange,
  children,
  height = 240,
  onHeightChange,
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
  children?: React.ReactNode;
  height?: number;
  onHeightChange?: (h: number) => void;
}) {
  // Lock body scroll when the drawer is open on mobile so the page
  // doesn't scroll behind it. Drawer never covers the composer — it
  // sits above it with a capped height.
  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    if (!mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleResizeStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startY;
      const newHeight = Math.max(120, Math.min(500, startHeight - delta));
      onHeightChange?.(newHeight);
    };
    
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <>
      {/* Toggle handle — sits at the bottom edge above the composer, height resizable */}
      <div
        className="flex shrink-0 items-center justify-center border-t relative group"
        style={{
          height: 32,
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
        }}
      >
        {/* Resize handle — draggable top edge */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 left-0 right-0 h-1 cursor-row-resize opacity-0 group-hover:opacity-100 transition"
          style={{ backgroundColor: "var(--litt-primary)" }}
          aria-label="Resize drawer height"
          title="Drag to resize"
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex h-full w-full items-center justify-center gap-1.5 text-[10px] font-bold transition hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
          aria-label={open ? "Close drawer" : "Open drawer"}
          aria-expanded={open}
        >
          {open ? <PanelBottomClose size={13} className="pointer-events-none" /> : <PanelBottomOpen size={13} className="pointer-events-none" />}
          <span>{open ? "Close" : "Activity / Terminal"}</span>
        </button>
      </div>

      {open && (
        <div
          className="flex shrink-0 flex-col border-t"
          style={{
            backgroundColor: "var(--studio-surface)",
            borderColor: "var(--studio-border)",
            height: `${height}px`,
          }}
        >
          <div className="flex shrink-0 items-center gap-0.5 border-b px-1.5" style={{ borderColor: "var(--studio-border)" }}>
            {DRAWER_TABS.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTabChange(t.id)}
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold transition"
                  style={{
                    color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                    borderBottom: isActive ? "2px solid var(--litt-primary)" : "2px solid transparent",
                  }}
                  aria-label={t.label}
                >
                  <Icon size={12} className="pointer-events-none" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {children ?? (
              <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                {activeTab === "terminal" ? "Terminal not connected" : "No activity yet"}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
