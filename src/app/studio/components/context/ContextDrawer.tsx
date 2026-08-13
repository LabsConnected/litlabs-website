"use client";

/**
 * ContextDrawer — right-side contextual panel.
 *
 * Tabs: Files | Assets | Inspector
 *
 * Reuses existing StudioProjectFiles and StudioInspector content.
 * The Assets tab is backed by the real Asset Lake facade.
 * Does NOT duplicate data or logic.
 *
 * Fully controlled by the parent (CommandStudio) — this component owns
 * NO tab state of its own. This keeps localStorage persistence, the
 * Files/Assets/Inspector button styling, and the actual visible tab in sync
 * at all times (Phase C2.1 fix).
 *
 * Stays mounted at width 0 when closed on desktop so StudioProjectFiles
 * and StudioInspector do not lose state (scroll position, in-flight
 * fetches, etc). On mobile it is a fixed overlay that is only present
 * in the DOM while open, since a 0-width fixed overlay has no benefit
 * there and would still intercept focus.
 */

import { type ReactNode } from "react";
import { Folder, ClipboardList, PanelRightClose, ImageIcon } from "lucide-react";

export type ContextDrawerTab = "files" | "assets" | "inspector";

export interface ContextDrawerProps {
  /** Whether the drawer is open */
  open: boolean;
  /** Controlled active tab — CommandStudio is the single source of truth */
  activeTab: ContextDrawerTab;
  /** Called when the user clicks a tab inside the drawer */
  onTabChange: (tab: ContextDrawerTab) => void;
  /** Called when the drawer should close */
  onClose: () => void;
  /** Files tab content — rendered as a slot from the parent */
  filesContent: ReactNode;
  /** Assets tab content — rendered as a slot from the parent */
  assetsContent: ReactNode;
  /** Inspector tab content — rendered as a slot from the parent */
  inspectorContent: ReactNode;
}

const TABS: { id: ContextDrawerTab; label: string; icon: typeof Folder }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "assets", label: "Assets", icon: ImageIcon },
  { id: "inspector", label: "Inspector", icon: ClipboardList },
];

export default function ContextDrawer({
  open,
  activeTab,
  onTabChange,
  onClose,
  filesContent,
  assetsContent,
  inspectorContent,
}: ContextDrawerProps) {
  return (
    <>
      {/* Mobile backdrop — only present while open */}
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/45 lg:hidden"
          onClick={onClose}
          aria-label="Close context drawer"
          tabIndex={-1}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 right-0 z-40 flex flex-col overflow-hidden border-l
          transition-[width] duration-150 ease-out
          lg:relative lg:z-auto lg:inset-auto
          ${open ? "w-[min(92vw,300px)]" : "pointer-events-none w-0 border-transparent lg:w-0"}
        `}
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: open ? "var(--studio-border)" : "transparent",
          backdropFilter: "blur(12px)",
        }}
        data-testid="context-drawer"
        data-open={open}
        aria-label="Context drawer"
        aria-hidden={!open}
      >
        {/* Inner content — fixed width so it doesn't reflow while collapsing */}
        <div className="flex h-full w-[min(92vw,300px)] flex-col overflow-hidden">
          {/* Tab header */}
          <div
            className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5"
            style={{
              borderColor: "var(--studio-border)",
              backgroundColor: "rgba(13,9,22,0.6)",
            }}
          >
            {TABS.map((t) => {
              const TabIcon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTabChange(t.id)}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
                  style={{
                    color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                    backgroundColor: isActive ? "rgba(139,92,246,0.1)" : "transparent",
                  }}
                  aria-pressed={isActive}
                  aria-label={t.label}
                  data-testid={`context-tab-${t.id}`}
                  tabIndex={open ? 0 : -1}
                >
                  <TabIcon size={12} className="pointer-events-none" />
                  {t.label}
                </button>
              );
            })}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close context drawer"
              data-testid="context-drawer-close"
              tabIndex={open ? 0 : -1}
            >
              <PanelRightClose size={14} className="pointer-events-none" />
            </button>
          </div>

          {/* Tab panels — grid-stacked for state preservation.
              Both stay mounted regardless of open/closed or active tab so
              StudioProjectFiles / StudioInspector never lose scroll
              position or in-flight state. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{
                visibility: open && activeTab === "files" ? "visible" : "hidden",
                pointerEvents: open && activeTab === "files" ? "auto" : "none",
              }}
              data-active={open && activeTab === "files"}
              data-testid="context-files-panel"
            >
              {filesContent}
            </div>
            <div
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{
                visibility: open && activeTab === "assets" ? "visible" : "hidden",
                pointerEvents: open && activeTab === "assets" ? "auto" : "none",
              }}
              data-active={open && activeTab === "assets"}
              data-testid="context-assets-panel"
            >
              {assetsContent}
            </div>
            <div
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{
                visibility: open && activeTab === "inspector" ? "visible" : "hidden",
                pointerEvents: open && activeTab === "inspector" ? "auto" : "none",
              }}
              data-active={open && activeTab === "inspector"}
              data-testid="context-inspector-panel"
            >
              {inspectorContent}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
