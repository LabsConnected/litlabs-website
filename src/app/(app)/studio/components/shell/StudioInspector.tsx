"use client";

import { type ReactNode, useState } from "react";
import { studioColors, studioLayout, studioSpacing, studioMotion } from "@/lib/studio/design-tokens";
import { StudioTabs, type StudioTab } from "../primitives/StudioTabs";

/* ─────────────────────────────────────────────────────────────────
 * StudioInspector — Region 4: Right intelligence inspector.
 *
 * Permanent tabs: Plan, Activity, Changes, Checks, Acceptance, Review.
 *
 * Rules:
 * - Plan explains intended work.
 * - Activity explains what is happening now.
 * - Changes explains code mutations.
 * - Checks explains automated validation.
 * - Acceptance explains requirement coverage.
 * - Review combines those sources into a decision.
 * - Approvals appear contextually inside Activity or Review.
 *
 * Phase 10.3 — Permanent shell
 * ───────────────────────────────────────────────────────────────── */

export type InspectorTabId = "plan" | "activity" | "changes" | "checks" | "acceptance" | "review";

interface StudioInspectorProps {
  activeTab: InspectorTabId;
  onTabChange: (tab: InspectorTabId) => void;
  /** Badge counts per tab */
  badges?: Partial<Record<InspectorTabId, number>>;
  /** Tab content renderers */
  renderTab: (tab: InspectorTabId) => ReactNode;
  /** Whether the inspector is open (mobile/tablet) */
  open?: boolean;
  onClose?: () => void;
  /** Width override */
  width?: string;
}

const DEFAULT_TABS: StudioTab[] = [
  { id: "plan", label: "Plan" },
  { id: "activity", label: "Activity" },
  { id: "changes", label: "Changes" },
  { id: "checks", label: "Checks" },
  { id: "acceptance", label: "Acceptance" },
  { id: "review", label: "Review" },
];

export function StudioInspector({
  activeTab,
  onTabChange,
  badges,
  renderTab,
  open = true,
  onClose,
  width,
}: StudioInspectorProps) {
  const tabs = DEFAULT_TABS.map((t) => ({
    ...t,
    badge: badges?.[t.id as InspectorTabId],
  }));

  const inspectorWidth = width ?? studioLayout.inspectorWidth;

  return (
    <aside
      style={{
        width: open ? inspectorWidth : 0,
        background: studioColors.surface,
        borderLeft: `1px solid ${studioColors.borderNeutral}`,
        flexShrink: 0,
        overflow: "hidden",
        transition: `width ${studioMotion.slow} ${studioMotion.ease}`,
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="studio-inspector"
      role="complementary"
      aria-label="Studio inspector"
    >
      {open && (
        <>
          {/* Tab bar */}
          <div
            style={{
              borderBottom: `1px solid ${studioColors.borderNeutral}`,
              flexShrink: 0,
              overflowX: "auto",
            }}
          >
            <StudioTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(id) => onTabChange(id as InspectorTabId)}
              testId="inspector-tabs"
            />
          </div>

          {/* Tab content */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: studioSpacing[6],
            }}
            data-testid="inspector-content"
          >
            {renderTab(activeTab)}
          </div>
        </>
      )}
    </aside>
  );
}
