"use client";

/**
 * StudioShell — the desktop Studio operating shell (replaces the panel
 * dashboard and the superseded floating-window compositor).
 *
 *   ┌ taskbar (durable worktabs — task identity, not layout) ┐
 *   ├ rail │        STAGE         │ inspector ┤
 *   └──────── LiTT command layer (bottom, resizes stage) ────┘
 *
 * The Stage owns exactly one active workspace surface; visited surfaces
 * stay mounted (hidden) so preview iframes, terminal sessions, files,
 * and canvas state survive surface/task switching.
 *
 * LiTT is shell chrome — a bottom command bar that expands upward —
 * never a floating window.
 */
import { type ReactNode } from "react";

export default function StudioShell({
  taskbar,
  rail,
  stage,
  inspector,
  littLayer,
  phoneNav,
}: {
  /** Task strip — the durable task tabs (WorktabBar). */
  taskbar: ReactNode;
  /** Left workspace rail. */
  rail: ReactNode;
  /** Central stage — the active workspace surface. */
  stage: ReactNode;
  /** Right contextual inspector. */
  inspector: ReactNode;
  /** Bottom LiTT command layer. */
  littLayer: ReactNode;
  /** Phone tier (<768px) bottom chrome. When provided, the shell renders
      the single responsive phone column instead of the desktop grid:
      taskbar → stage → LiTT layer → phone nav. The inspector is rendered
      by the caller as a bottom sheet, not here. */
  phoneNav?: ReactNode;
}) {
  if (phoneNav) {
    return (
      <div
        className="studio-shell flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
        data-testid="studio-shell"
        data-phone="true"
      >
        {taskbar}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="studio-stage">
          {stage}
        </div>
        {/* Safe-area gap so the collapsed composer never sits flush
            against the bottom nav on notched phones. */}
        <div className="shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {littLayer}
        </div>
        {phoneNav}
      </div>
    );
  }

  return (
    <div
      className="studio-shell flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="studio-shell"
    >
      {taskbar}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {rail}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="studio-stage">
          {stage}
        </div>
        {inspector}
      </div>
      {littLayer}
    </div>
  );
}
