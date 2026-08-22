"use client";

import { type ReactNode } from "react";
import { studioColors, studioLayout, studioSpacing, studioRadius } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioComposer — Region 5: Bottom composer.
 *
 * Contains: prompt input, context/attachments, mode/profile/model
 * controls, PLAN/ACT switch, run/cancel action, contextual action
 * suggestions, compact active-run progress.
 *
 * Stays accessible but must not cover workspace or drawer content.
 *
 * Phase 10.3 — Permanent shell
 * ───────────────────────────────────────────────────────────────── */

interface StudioComposerProps {
  children: ReactNode;
  /** Compact active-run progress bar */
  runProgress?: ReactNode;
  /** Whether the composer is disabled (e.g. during approval) */
  disabled?: boolean;
}

export function StudioComposer({ children, runProgress, disabled }: StudioComposerProps) {
  return (
    <footer
      style={{
        background: studioColors.shell,
        borderTop: `1px solid ${studioColors.borderNeutral}`,
        flexShrink: 0,
        padding: `${studioSpacing[4]} ${studioSpacing[8]}`,
        maxWidth: studioLayout.composerMaxWidth,
        margin: "0 auto",
        width: "100%",
      }}
      data-testid="studio-composer"
      role="contentinfo"
    >
      {runProgress && (
        <div style={{ marginBottom: studioSpacing[4] }} data-testid="composer-run-progress">
          {runProgress}
        </div>
      )}
      <div
        style={{
          borderRadius: studioRadius.xl,
          background: studioColors.surface,
          border: `1px solid ${studioColors.borderNeutral}`,
          opacity: disabled ? 0.6 : 1,
          transition: "opacity 120ms ease",
        }}
      >
        {children}
      </div>
    </footer>
  );
}
