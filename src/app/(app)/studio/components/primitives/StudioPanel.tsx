"use client";

import { type ReactNode, useState } from "react";
import { studioColors, studioRadius, studioSpacing, studioMotion } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioPanel — bounded information container.
 *
 * Used for bounded information groups, not every row.
 * Optional header with title and action area.
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

interface StudioPanelProps {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Border tone for semantic emphasis */
  tone?: "neutral" | "violet" | "warning" | "error";
  /** Whether the panel is collapsible */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  testId?: string;
}

export function StudioPanel({
  title,
  icon,
  actions,
  children,
  tone = "neutral",
  collapsible = false,
  defaultCollapsed = false,
  testId,
}: StudioPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const borderColor =
    tone === "warning" ? "rgba(251, 178, 68, 0.25)" :
    tone === "error" ? "rgba(248, 113, 113, 0.25)" :
    tone === "violet" ? studioColors.borderStrong :
    studioColors.borderNeutral;

  return (
    <div
      style={{
        borderRadius: studioRadius.lg,
        border: `1px solid ${borderColor}`,
        background: studioColors.card,
        overflow: "hidden",
      }}
      data-testid={testId}
    >
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${studioSpacing[4]} ${studioSpacing[6]}`,
            borderBottom: collapsed ? "none" : `1px solid ${studioColors.borderNeutral}`,
            cursor: collapsible ? "pointer" : "default",
            userSelect: "none",
          }}
          onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
        >
          <div style={{ display: "flex", alignItems: "center", gap: studioSpacing[4] }}>
            {icon}
            {title && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: studioColors.textPrimary,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {title}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: studioSpacing[2] }}>
            {actions}
            {collapsible && (
              <span
                style={{
                  color: studioColors.textMuted,
                  fontSize: 10,
                  transition: `transform ${studioMotion.fast} ${studioMotion.ease}`,
                  transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
            )}
          </div>
        </div>
      )}
      {!collapsed && (
        <div style={{ padding: studioSpacing[6] }}>
          {children}
        </div>
      )}
    </div>
  );
}
