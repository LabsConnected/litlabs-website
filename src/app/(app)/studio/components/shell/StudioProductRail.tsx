"use client";

import { type ReactNode } from "react";
import { studioColors, studioLayout, studioSpacing, studioRadius, studioMotion, studioTypography } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioProductRail — Region 2: Left product rail.
 *
 * Primary destinations: Build, Chat, Code, Preview, Files, Assets,
 * Agents, Runs. Secondary destinations in a More menu.
 *
 * The rail selects product destinations. It must NOT also behave as
 * an inspector or workspace-state controller.
 *
 * Phase 10.3 — Permanent shell
 * ───────────────────────────────────────────────────────────────── */

export interface RailDestination {
  id: string;
  label: string;
  icon: ReactNode;
  /** Badge count (e.g. unread runs) */
  badge?: number;
}

interface StudioProductRailProps {
  destinations: RailDestination[];
  activeDestination: string;
  onDestinationChange: (id: string) => void;
  /** Secondary destinations for the More menu */
  secondaryDestinations?: RailDestination[];
  /** Compact mode (icons only, no labels) */
  compact?: boolean;
}

export function StudioProductRail({
  destinations,
  activeDestination,
  onDestinationChange,
  secondaryDestinations = [],
  compact = false,
}: StudioProductRailProps) {
  const railWidth = compact ? studioLayout.railWidthCompact : studioLayout.railWidth;

  return (
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        width: railWidth,
        background: studioColors.shell,
        borderRight: `1px solid ${studioColors.borderNeutral}`,
        flexShrink: 0,
        padding: `${studioSpacing[4]} 0`,
        gap: studioSpacing[1],
      }}
      data-testid="studio-product-rail"
      role="navigation"
      aria-label="Product navigation"
    >
      {destinations.map((dest) => {
        const isActive = dest.id === activeDestination;
        return (
          <button
            key={dest.id}
            onClick={() => onDestinationChange(dest.id)}
            aria-label={dest.label}
            aria-current={isActive ? "page" : undefined}
            title={dest.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: studioSpacing[1],
              padding: `${studioSpacing[4]} ${studioSpacing[2]}`,
              margin: `0 ${studioSpacing[2]}`,
              borderRadius: studioRadius.md,
              border: "1px solid transparent",
              background: isActive ? studioColors.violetSoft : "transparent",
              color: isActive ? studioColors.violet : studioColors.textMuted,
              cursor: "pointer",
              transition: `background ${studioMotion.fast} ${studioMotion.ease}, color ${studioMotion.fast} ${studioMotion.ease}`,
              fontFamily: "inherit",
              position: "relative",
            }}
            data-testid={`rail-${dest.id}`}
          >
            {dest.icon}
            {!compact && (
              <span
                style={{
                  fontSize: studioTypography.xs,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {dest.label}
              </span>
            )}
            {dest.badge !== undefined && dest.badge > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  fontSize: 8,
                  fontWeight: 700,
                  padding: `1px 4px`,
                  borderRadius: studioRadius.full,
                  background: studioColors.red,
                  color: "#fff",
                  minWidth: 14,
                  textAlign: "center",
                }}
              >
                {dest.badge}
              </span>
            )}
            {isActive && (
              <span
                style={{
                  position: "absolute",
                  left: -2,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 3,
                  height: 20,
                  borderRadius: studioRadius.full,
                  background: studioColors.violet,
                }}
              />
            )}
          </button>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Secondary destinations */}
      {secondaryDestinations.length > 0 && (
        <>
          <div
            style={{
              height: 1,
              margin: `${studioSpacing[4]} ${studioSpacing[6]}`,
              background: studioColors.borderNeutral,
            }}
          />
          {secondaryDestinations.map((dest) => {
            const isActive = dest.id === activeDestination;
            return (
              <button
                key={dest.id}
                onClick={() => onDestinationChange(dest.id)}
                aria-label={dest.label}
                title={dest.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: studioSpacing[1],
                  padding: `${studioSpacing[4]} ${studioSpacing[2]}`,
                  margin: `0 ${studioSpacing[2]}`,
                  borderRadius: studioRadius.md,
                  border: "1px solid transparent",
                  background: isActive ? studioColors.violetSoft : "transparent",
                  color: isActive ? studioColors.violet : studioColors.textMuted,
                  cursor: "pointer",
                  transition: `background ${studioMotion.fast} ${studioMotion.ease}, color ${studioMotion.fast} ${studioMotion.ease}`,
                  fontFamily: "inherit",
                  position: "relative",
                }}
                data-testid={`rail-secondary-${dest.id}`}
              >
                {dest.icon}
                {!compact && (
                  <span style={{ fontSize: studioTypography.xs, fontWeight: 600 }}>
                    {dest.label}
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}
    </nav>
  );
}
