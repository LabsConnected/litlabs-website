"use client";

/**
 * LiTTAppShell — the shared app frame for the non-Studio product pages
 * (Projects first; Discover and Settings adopt it later — Projects
 * redesign Decision D, Larry 2026-11-13).
 *
 * It is deliberately a FRAME, not a nav system: the global top bar
 * (AppShell) and the nav data (src/lib/navigation.ts) already exist
 * above it. This component provides what every page used to hand-roll:
 *
 *   - a fixed-width left sidebar container (280px, inside the
 *     260–310px band all three redesign directives ask for), whose
 *     CONTENT is per-page (Projects categories, Discover feed nav,
 *     Settings sections are different lists — the shell shares chrome
 *     and tokens, not sidebar contents);
 *   - the responsive collapse: under the lg breakpoint the sidebar
 *     becomes a left drawer opened from a toolbar row;
 *   - a shared content region (max width + padding) with an optional
 *     per-page header slot;
 *   - an optional right rail (Discover's Trending rail is the first
 *     consumer), shown only at xl widths so narrower layouts keep the
 *     single-column reading flow. Added in the Discover phase as a
 *     minimal extension of the Projects-phase frame — same tokens,
 *     same sticky-column treatment as the sidebar.
 *
 * Colors are passed in (structural subset of the theme's
 * resolvedColors) instead of read from context. Pages pass their
 * useTheme() resolvedColors unchanged, so the frame renders in the
 * user's normal theme — /projects included, since Larry's all-light
 * ruling (2026-11-13) removed the earlier Neon Grove pack scoping.
 * A caller that renders the frame without resolved colors (a
 * partial theme harness, an early paint) must not crash it: the
 * palette falls back field-by-field to the platform default
 * (FALLBACK_COLORS) and the caller's colors win wherever given.
 *
 * It does NOT special-case Studio (Studio keeps its own viewport-
 * locked StudioShell and LayoutShell already routes around it) and it
 * renders nothing for marketing/signed-out hybrid paths — those stay
 * with LayoutShell.
 */

import { ReactNode, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

export interface AppShellColors {
  bgColor: string;
  textColor: string;
  textMuted: string;
  headerColor: string;
  borderColor: string;
  accentColor: string;
  boxBg: string;
  /** Sidebar surface when it differs from boxBg. */
  sidebarBg?: string;
  /** Elevated panel surface when the palette defines one. */
  elevatedBg?: string;
}

/**
 * Platform-default palette — field-for-field the LiTT Signature
 * light skin (lightSkins.signature in src/context/ThemeContext.tsx,
 * the defaultTheme's skin), with textMuted derived from textColor
 * exactly as ThemeContext's getResolvedColors derives it. Used only
 * as the fallback base when a caller passes no (or partial) colors;
 * a real page's resolvedColors override every field they set.
 */
const FALLBACK_COLORS: AppShellColors = {
  bgColor: "#FFFFFF",
  textColor: "#0E1510",
  textMuted: "#717573",
  headerColor: "#0C5A26",
  borderColor: "#CFDEC4",
  accentColor: "#177A36",
  boxBg: "#FFFFFF",
};

interface LiTTAppShellProps {
  colors: AppShellColors;
  /** Per-page sidebar content (categories / sections / feed nav). */
  sidebar: ReactNode;
  /** Accessible name for the sidebar region and its drawer. */
  sidebarLabel: string;
  /** Optional per-page hero/title band rendered above the content. */
  header?: ReactNode;
  /** Optional right rail (e.g. Discover's Trending rail); xl+ only. */
  rightRail?: ReactNode;
  /** Accessible name for the right rail region. */
  rightRailLabel?: string;
  children: ReactNode;
}

export default function LiTTAppShell({
  colors: colorsProp,
  sidebar,
  sidebarLabel,
  header,
  rightRail,
  rightRailLabel,
  children,
}: LiTTAppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // The caller's colors win field-by-field; anything they did not
  // pass (including the whole object, from a partial theme harness)
  // falls back to the platform default palette instead of crashing.
  const colors: AppShellColors = { ...FALLBACK_COLORS, ...colorsProp };

  const sidebarSurface = {
    backgroundColor: colors.sidebarBg ?? colors.boxBg,
    borderColor: `${colors.borderColor}55`,
  } as const;

  return (
    <div
      className="w-full"
      style={{ backgroundColor: colors.bgColor, color: colors.textColor }}
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-stretch">
        {/* Desktop sidebar */}
        <aside
          aria-label={sidebarLabel}
          className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col overflow-y-auto border-r px-4 py-6 lg:flex"
          style={sidebarSurface}
          onClick={(e) => {
            // Selecting anything in the drawer-style nav closes a
            // mobile drawer; on desktop this is a no-op state write.
            if ((e.target as HTMLElement).closest("a,button")) {
              setDrawerOpen(false);
            }
          }}
        >
          {sidebar}
        </aside>

        {/* Content region */}
        <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {/* Mobile/tablet sidebar trigger */}
          <div className="mb-4 flex items-center gap-3 lg:hidden">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold"
              style={{
                borderColor: `${colors.borderColor}55`,
                color: colors.textColor,
                backgroundColor: colors.boxBg,
              }}
            >
              <Menu size={16} style={{ color: colors.accentColor }} />
              {sidebarLabel}
            </button>
          </div>

          {header}
          {children}
        </div>

        {/* Right rail — xl widths only, mirrors the sidebar's sticky
            column treatment on the opposite edge. */}
        {rightRail && (
          <aside
            aria-label={rightRailLabel ?? "Sidebar"}
            className="sticky top-0 hidden h-screen w-[320px] shrink-0 overflow-y-auto border-l px-4 py-6 xl:block"
            style={{
              backgroundColor: colors.elevatedBg ?? colors.boxBg,
              borderColor: `${colors.borderColor}55`,
            }}
          >
            {rightRail}
          </aside>
        )}
      </div>

      {/* Mobile/tablet drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[200] flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={sidebarLabel}
        >
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="relative flex h-full w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r px-4 py-6"
            style={sidebarSurface}
          >
            <div className="mb-4 flex items-center justify-between">
              <span
                className="text-[10px] font-black uppercase tracking-[0.2em]"
                style={{ color: colors.accentColor }}
              >
                {sidebarLabel}
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close sidebar"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border"
                style={{
                  borderColor: `${colors.borderColor}55`,
                  color: colors.textColor,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a,button")) {
                  setDrawerOpen(false);
                }
              }}
            >
              {sidebar}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
