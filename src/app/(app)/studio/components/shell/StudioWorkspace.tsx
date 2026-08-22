"use client";

import { type ReactNode } from "react";
import { studioColors, studioSpacing } from "@/lib/studio/design-tokens";

/* ─────────────────────────────────────────────────────────────────
 * StudioWorkspace — Region 3: Primary workspace canvas.
 *
 * A stable canvas hosting conversation, code editor, preview, diff,
 * files, generated artifacts, visual builder, terminal, or split views.
 *
 * Workspace tabs support:
 * - One active view
 * - Optional two-pane split
 * - Retained state when switching
 * - URL-addressable primary views
 * - Explicit focus ownership
 *
 * Phase 10.3 — Permanent shell
 * ───────────────────────────────────────────────────────────────── */

interface StudioWorkspaceProps {
  children: ReactNode;
  /** Optional split view content (right pane) */
  splitView?: ReactNode;
  /** Whether split view is active */
  split?: boolean;
}

export function StudioWorkspace({ children, splitView, split = false }: StudioWorkspaceProps) {
  if (split && splitView) {
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
        data-testid="studio-workspace-split"
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            borderRight: `1px solid ${studioColors.borderNeutral}`,
          }}
          data-testid="studio-workspace-primary"
        >
          {children}
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
          data-testid="studio-workspace-secondary"
        >
          {splitView}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: studioSpacing[6],
      }}
      data-testid="studio-workspace"
    >
      {children}
    </div>
  );
}
