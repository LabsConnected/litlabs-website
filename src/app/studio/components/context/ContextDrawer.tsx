"use client";

/**
 * ContextDrawer — right-side contextual panel.
 *
 * Tabs: Files | Inspector
 *
 * Reuses existing StudioProjectFiles and StudioInspector content.
 * Does NOT duplicate data or logic.
 *
 * Closes completely to 0px — workspace reclaims width immediately.
 */

import { useState, useCallback, type ReactNode } from "react";
import { Folder, ClipboardList, X, PanelRightClose } from "lucide-react";
import type { InspectorTab } from "../../lib/studio-destinations";

export type ContextDrawerTab = "files" | "inspector";

export interface ContextDrawerProps {
  /** Whether the drawer is open */
  open: boolean;
  /** Called when the drawer should close */
  onClose: () => void;
  /** Initial active tab */
  initialTab?: ContextDrawerTab;
  /** Files tab content — rendered as a slot from the parent */
  filesContent: ReactNode;
  /** Inspector tab content — rendered as a slot from the parent */
  inspectorContent: ReactNode;
  /** Inspector tab id for sub-tab navigation */
  inspectorActiveTab?: InspectorTab;
  onInspectorTabChange?: (tab: InspectorTab) => void;
}

const TABS: { id: ContextDrawerTab; label: string; icon: typeof Folder }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "inspector", label: "Inspector", icon: ClipboardList },
];

export default function ContextDrawer({
  open,
  onClose,
  initialTab = "files",
  filesContent,
  inspectorContent,
}: ContextDrawerProps) {
  const [activeTab, setActiveTab] = useState<ContextDrawerTab>(initialTab);

  const handleTabChange = useCallback((tab: ContextDrawerTab) => {
    setActiveTab(tab);
  }, []);

  // When closed, render nothing — workspace reclaims width immediately.
  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-30 bg-black/45 lg:hidden"
        onClick={onClose}
        aria-label="Close context drawer"
        tabIndex={-1}
      />

      <aside
        className="
          fixed inset-y-0 right-0 z-40 flex w-[min(92vw,300px)] flex-col border-l
          lg:relative lg:z-auto lg:inset-auto
        "
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
          backdropFilter: "blur(12px)",
        }}
        data-testid="context-drawer"
        aria-label="Context drawer"
      >
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
                onClick={() => handleTabChange(t.id)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
                style={{
                  color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                  backgroundColor: isActive ? "rgba(139,92,246,0.1)" : "transparent",
                }}
                aria-pressed={isActive}
                aria-label={t.label}
                data-testid={`context-tab-${t.id}`}
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
          >
            <PanelRightClose size={14} className="pointer-events-none" />
          </button>
        </div>

        {/* Tab panels — grid-stacked for state preservation */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{
              visibility: activeTab === "files" ? "visible" : "hidden",
              pointerEvents: activeTab === "files" ? "auto" : "none",
            }}
            data-active={activeTab === "files"}
            data-testid="context-files-panel"
          >
            {filesContent}
          </div>
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{
              visibility: activeTab === "inspector" ? "visible" : "hidden",
              pointerEvents: activeTab === "inspector" ? "auto" : "none",
            }}
            data-active={activeTab === "inspector"}
            data-testid="context-inspector-panel"
          >
            {inspectorContent}
          </div>
        </div>
      </aside>
    </>
  );
}
