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
import { isTerminalDisabled } from "@/lib/terminal-config";

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
].filter((t): t is { id: DrawerTab; label: string; icon: typeof Activity } => !(t.id === "terminal" && isTerminalDisabled()));

export function StudioInspector({
  open,
  onToggle,
  activeTab,
  onTabChange,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  children?: React.ReactNode;
}) {
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
            width: "min(320px, 30vw)",
          }}
        >
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
}: {
  open: boolean;
  onToggle: () => void;
  activeTab: DrawerTab;
  onTabChange: (t: DrawerTab) => void;
  children?: React.ReactNode;
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

  return (
    <>
      {/* Toggle handle — sits at the bottom edge above the composer */}
      <div
        className="flex shrink-0 items-center justify-center border-t"
        style={{
          height: 32,
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
        }}
      >
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
            height: "min(240px, 30dvh)",
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
