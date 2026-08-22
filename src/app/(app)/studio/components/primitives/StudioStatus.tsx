"use client";

import { type ReactNode } from "react";
import { studioColors, studioRadius, studioSpacing, studioTypography, statusColor, statusBg, type StatusTone } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioStatus — status badge primitive.
 *
 * Shows a colored dot + label. Color is always paired with an icon
 * or label (never color alone).
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

interface StudioStatusProps {
  tone: StatusTone;
  label: string;
  icon?: ReactNode;
  size?: "sm" | "md";
  dot?: boolean;
}

export function StudioStatus({ tone, label, icon, size = "sm", dot = true }: StudioStatusProps) {
  const color = statusColor(tone);
  const bg = statusBg(tone);
  const fontSize = size === "sm" ? studioTypography.xs : studioTypography.sm;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: studioSpacing[2],
        padding: `${studioSpacing[1]} ${studioSpacing[4]}`,
        borderRadius: studioRadius.full,
        background: bg,
        color,
        fontSize,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
      data-testid={`studio-status-${tone}`}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
      )}
      {icon}
      {label}
    </span>
  );
}
