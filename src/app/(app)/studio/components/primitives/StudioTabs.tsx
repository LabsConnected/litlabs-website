"use client";

import { type ReactNode } from "react";
import { studioColors, studioRadius, studioSpacing, studioMotion } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioTabs — tab bar primitive.
 *
 * One active tab. Retained state when switching is handled by the parent.
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

export interface StudioTab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

interface StudioTabsProps {
  tabs: StudioTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /** Vertical orientation for side tabs */
  vertical?: boolean;
  testId?: string;
}

export function StudioTabs({ tabs, activeTab, onTabChange, vertical = false, testId }: StudioTabsProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        gap: vertical ? studioSpacing[1] : studioSpacing[2],
        padding: studioSpacing[2],
      }}
      data-testid={testId ?? "studio-tabs"}
      role="tablist"
      aria-orientation={vertical ? "vertical" : "horizontal"}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: studioSpacing[2],
              padding: `${studioSpacing[2]} ${studioSpacing[4]}`,
              borderRadius: studioRadius.md,
              border: "1px solid transparent",
              background: isActive ? studioColors.violetSoft : "transparent",
              color: isActive ? studioColors.violet : studioColors.textMuted,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              transition: `background ${studioMotion.fast} ${studioMotion.ease}, color ${studioMotion.fast} ${studioMotion.ease}`,
              whiteSpace: "nowrap",
              flex: vertical ? undefined : 1,
              justifyContent: vertical ? "flex-start" : "center",
              fontFamily: "inherit",
            }}
            data-testid={`studio-tab-${tab.id}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: `1px ${studioSpacing[2]}`,
                  borderRadius: studioRadius.full,
                  background: isActive ? studioColors.violet : studioColors.graySoft,
                  color: isActive ? "#fff" : studioColors.textMuted,
                  minWidth: 16,
                  textAlign: "center",
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
