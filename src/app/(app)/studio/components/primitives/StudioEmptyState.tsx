"use client";

import { type ReactNode } from "react";
import { studioColors, studioRadius, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioEmptyState — empty/placeholder state primitive.
 *
 * Used when there's no data to show. Never shows fake/placeholder data.
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

interface StudioEmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

export function StudioEmptyState({ icon, title, description, action, testId }: StudioEmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 96,
        padding: studioSpacing[12],
        textAlign: "center",
      }}
      data-testid={testId ?? "studio-empty-state"}
    >
      {icon && (
        <div style={{ marginBottom: studioSpacing[4], color: studioColors.textMuted }}>
          {icon}
        </div>
      )}
      <div
        style={{
          fontSize: studioTypography.base,
          fontWeight: 600,
          color: studioColors.textSecondary,
          marginBottom: description ? studioSpacing[2] : 0,
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            fontSize: studioTypography.sm,
            color: studioColors.textMuted,
            maxWidth: 280,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      )}
      {action && (
        <div style={{ marginTop: studioSpacing[6] }}>
          {action}
        </div>
      )}
    </div>
  );
}
