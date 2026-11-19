"use client";

/**
 * StudioRightRail — the Regular (classic) layout's right rail, ported
 * from Larry's locked Studio mockup (2026-11-18): a 300px column
 * beside the center workspace with four tabs — Files · Activity ·
 * Checks · Approvals — every one wired to a real surface:
 *
 *   Files     → the single StudioProjectFiles composition
 *               (CommandStudio's projectFilesContent)
 *   Activity  → LiTTLiveActivity, the real execution telemetry feed
 *               (CommandStudio's littLiveContent)
 *   Checks    → StudioHealthPanel mode="checks"
 *   Approvals → StudioHealthPanel mode="approvals"
 *
 * No mock data and no second instances of the one-instance surfaces:
 * CommandStudio MOVES the Files and Activity contents here from the
 * desktop LiTT panel (the panel keeps Chat only in Regular); the
 * mobile sheet and context drawer keep their own mounts, which are
 * viewport-exclusive with this rail. Checks/Approvals are the same
 * read-model panels the board mounts.
 *
 * Panes stay mounted and toggle visibility (the LiTTPanel pattern),
 * so tab switches never drop the file tree's scroll position or the
 * activity feed's stream state. The rail is desktop-only (lg+);
 * below that, the mobile sheet/drawer own these surfaces.
 */

import type { ReactNode } from "react";

export type StudioRailTab = "files" | "activity" | "checks" | "approvals";

const RAIL_TABS: Array<{ id: StudioRailTab; label: string }> = [
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
  { id: "checks", label: "Checks" },
  { id: "approvals", label: "Approvals" },
];

interface StudioRightRailProps {
  activeTab: StudioRailTab;
  onTabChange: (tab: StudioRailTab) => void;
  filesContent: ReactNode;
  activityContent: ReactNode;
  checksContent: ReactNode;
  approvalsContent: ReactNode;
}

export default function StudioRightRail({
  activeTab,
  onTabChange,
  filesContent,
  activityContent,
  checksContent,
  approvalsContent,
}: StudioRightRailProps) {
  const panes: Array<{ id: StudioRailTab; content: ReactNode }> = [
    { id: "files", content: filesContent },
    { id: "activity", content: activityContent },
    { id: "checks", content: checksContent },
    { id: "approvals", content: approvalsContent },
  ];

  return (
    <aside
      className="hidden h-full w-[300px] shrink-0 flex-col overflow-hidden border-l lg:flex"
      style={{
        backgroundColor: "var(--studio-surface)",
        borderColor: "var(--studio-border)",
      }}
      data-testid="studio-right-rail"
      aria-label="Project panel"
    >
      <div
        className="flex shrink-0 border-b"
        style={{ borderColor: "var(--studio-border)" }}
        role="tablist"
        aria-label="Project panel tabs"
      >
        {RAIL_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`studio-rail-tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className="flex-1 border-b-2 px-1 py-2.5 text-[12px] transition-colors"
              style={{
                color: selected ? "var(--text-main)" : "var(--text-dim)",
                borderColor: selected ? "var(--color-accent)" : "transparent",
                fontWeight: selected ? 600 : 400,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {panes.map((pane) => (
          <div
            key={pane.id}
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{
              visibility: activeTab === pane.id ? "visible" : "hidden",
              pointerEvents: activeTab === pane.id ? "auto" : "none",
            }}
            data-active={activeTab === pane.id}
            data-testid={`studio-rail-pane-${pane.id}`}
          >
            {pane.content}
          </div>
        ))}
      </div>
    </aside>
  );
}
