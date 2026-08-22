"use client";

import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { studioColors, studioRadius, studioMotion, studioSpacing, studioTypography } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioButton — shared button primitive.
 *
 * Variants: primary | secondary | ghost | danger
 * Sizes: sm | md
 * States: default | hover | focus-visible | pressed | selected | disabled | loading
 *
 * Phase 10.2 — Design tokens and primitives
 * ───────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface StudioButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  selected?: boolean;
  fullWidth?: boolean;
}

function variantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: studioColors.violetSoft,
        color: studioColors.violet,
        border: `1px solid ${studioColors.violetBorder}`,
      };
    case "danger":
      return {
        background: studioColors.redSoft,
        color: studioColors.red,
        border: "1px solid rgba(248, 113, 113, 0.3)",
      };
    case "ghost":
      return {
        background: "transparent",
        color: studioColors.textSecondary,
        border: "1px solid transparent",
      };
    case "secondary":
    default:
      return {
        background: studioColors.card,
        color: studioColors.textPrimary,
        border: `1px solid ${studioColors.border}`,
      };
  }
}

function sizeStyle(size: ButtonSize): CSSProperties {
  switch (size) {
    case "sm":
      return {
        padding: `${studioSpacing[1]} ${studioSpacing[4]}`,
        fontSize: studioTypography.xs,
        minHeight: 24,
      };
    case "md":
    default:
      return {
        padding: `${studioSpacing[2]} ${studioSpacing[6]}`,
        fontSize: studioTypography.base,
        minHeight: 32,
      };
  }
}

export const StudioButton = forwardRef<HTMLButtonElement, StudioButtonProps>(
  ({ variant = "secondary", size = "md", loading, selected, fullWidth, disabled, children, style, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: studioSpacing[2],
          borderRadius: studioRadius.md,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: disabled || loading ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: `background ${studioMotion.fast} ${studioMotion.ease}, border-color ${studioMotion.fast} ${studioMotion.ease}, color ${studioMotion.fast} ${studioMotion.ease}`,
          width: fullWidth ? "100%" : undefined,
          ...(selected ? {
            borderColor: studioColors.violetBorder,
            background: studioColors.violetSoft,
          } : {}),
          ...variantStyle(variant),
          ...sizeStyle(size),
          ...style,
        }}
        {...props}
      >
        {loading && (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: `2px solid ${studioColors.textMuted}`,
              borderTopColor: "transparent",
              animation: "studio-spin 0.6s linear infinite",
            }}
          />
        )}
        {children}
      </button>
    );
  },
);

StudioButton.displayName = "StudioButton";
