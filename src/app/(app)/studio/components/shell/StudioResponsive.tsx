"use client";

import { type ReactNode, useState, useEffect, useCallback } from "react";
import { studioColors, studioLayout, studioSpacing, studioRadius, studioMotion, studioTypography } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * useViewportTier — responsive breakpoint hook.
 *
 * Returns the current viewport tier based on window width:
 * - desktop: 1440px+
 * - laptop: 1024–1439px
 * - tablet: 768–1023px
 * - mobile: <768px
 *
 * Phase 10.7 — Responsive completion
 * ───────────────────────────────────────────────────────────────── */

export type ViewportTier = "desktop" | "laptop" | "tablet" | "mobile";

export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>("desktop");

  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      if (w >= 1440) setTier("desktop");
      else if (w >= 1024) setTier("laptop");
      else if (w >= 768) setTier("tablet");
      else setTier("mobile");
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return tier;
}

export function useIsMobile(): boolean {
  return useViewportTier() === "mobile";
}

export function useIsTablet(): boolean {
  const tier = useViewportTier();
  return tier === "tablet";
}

/* ─────────────────────────────────────────────────────────────────
 * StudioMobileNavigation — bottom navigation for mobile.
 *
 * Mobile task flow: compact project/run bar → single workspace →
 * composer → bottom navigation → full-height inspector/review sheet.
 *
 * Only one major sheet owns focus at a time.
 *
 * Phase 10.7 — Responsive completion
 * ───────────────────────────────────────────────────────────────── */

export interface MobileNavTab {
  id: string;
  label: string;
  icon: ReactNode;
}

interface StudioMobileNavigationProps {
  tabs: MobileNavTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export function StudioMobileNavigation({ tabs, activeTab, onTabChange }: StudioMobileNavigationProps) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        height: 56,
        background: studioColors.shell,
        borderTop: `1px solid ${studioColors.borderNeutral}`,
        flexShrink: 0,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      data-testid="studio-mobile-nav"
      role="navigation"
      aria-label="Mobile navigation"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              flex: 1,
              height: "100%",
              background: "transparent",
              border: "none",
              color: isActive ? studioColors.violet : studioColors.textMuted,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: `color ${studioMotion.fast} ${studioMotion.ease}`,
              WebkitTapHighlightColor: "transparent",
            }}
            data-testid={`mobile-nav-${tab.id}`}
          >
            {tab.icon}
            <span style={{
              fontSize: 9,
              fontWeight: 600,
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * StudioMobileSheet — full-height sheet for mobile inspector/review.
 *
 * Only one major sheet should own focus at a time. Composer,
 * inspector, terminal, and context surfaces need a shared layering
 * contract.
 *
 * Phase 10.7 — Responsive completion
 * ───────────────────────────────────────────────────────────────── */

interface StudioMobileSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function StudioMobileSheet({ open, onClose, title, children }: StudioMobileSheetProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        background: studioColors.canvas,
      }}
      data-testid="studio-mobile-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 48,
          padding: `0 ${studioSpacing[6]}`,
          background: studioColors.shell,
          borderBottom: `1px solid ${studioColors.borderNeutral}`,
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <span style={{
          fontSize: studioTypography.lg,
          fontWeight: 600,
          color: studioColors.textPrimary,
        }}>
          {title}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            color: studioColors.textMuted,
            fontSize: 20,
            cursor: "pointer",
            fontFamily: "inherit",
            padding: studioSpacing[2],
          }}
          data-testid="mobile-sheet-close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: studioSpacing[6],
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * StudioResponsiveShell — responsive wrapper around StudioShell.
 *
 * Desktop/Laptop: Full 5-region layout with persistent inspector.
 * Tablet: Inspector becomes a dismissible overlay.
 * Mobile: Single workspace + composer + bottom nav + full-height sheets.
 *
 * Phase 10.7 — Responsive completion
 * ───────────────────────────────────────────────────────────────── */

interface StudioResponsiveShellProps {
  tier: ViewportTier;
  children: ReactNode;
  /** Mobile sheet content (inspector/review) */
  mobileSheet?: { open: boolean; title: string; content: ReactNode } | null;
  onMobileSheetClose?: () => void;
  /** Mobile bottom nav */
  mobileNav?: { tabs: MobileNavTab[]; activeTab: string; onTabChange: (id: string) => void } | null;
}

export function StudioResponsiveShell({
  tier,
  children,
  mobileSheet,
  onMobileSheetClose,
  mobileNav,
}: StudioResponsiveShellProps) {
  if (tier === "mobile") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          background: studioColors.canvas,
          overflow: "hidden",
        }}
        data-testid="responsive-shell-mobile"
      >
        <div style={{ flex: 1, overflow: "hidden" }}>
          {children}
        </div>
        {mobileNav && (
          <StudioMobileNavigation
            tabs={mobileNav.tabs}
            activeTab={mobileNav.activeTab}
            onTabChange={mobileNav.onTabChange}
          />
        )}
        {mobileSheet && (
          <StudioMobileSheet
            open={mobileSheet.open}
            onClose={onMobileSheetClose ?? (() => {})}
            title={mobileSheet.title}
          >
            {mobileSheet.content}
          </StudioMobileSheet>
        )}
      </div>
    );
  }

  // Desktop, laptop, tablet all use the standard shell
  // Tablet differences (overlay inspector) are handled by the shell itself
  return (
    <div data-testid={`responsive-shell-${tier}`}>
      {children}
    </div>
  );
}
