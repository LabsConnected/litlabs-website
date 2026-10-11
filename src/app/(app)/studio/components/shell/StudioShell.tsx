"use client";

/**
 * StudioShell — the desktop Studio operating shell (replaces the panel
 * dashboard and the superseded floating-window compositor).
 *
 *   ┌ taskbar (durable worktabs — task identity, not layout) ┐
 *   ├ LiTT │ rail │     STAGE      │ inspector ┤   (LiTT left-docked)
 *   ├ rail │        STAGE         │ inspector ┤   (LiTT bottom-docked)
 *   └──────── LiTT command layer (bottom, resizes stage) ────┘
 *
 * The Stage owns exactly one active workspace surface; visited surfaces
 * stay mounted (hidden) so preview iframes, terminal sessions, files,
 * and canvas state survive surface/task switching.
 *
 * LiTT is shell chrome — a left dock panel or a bottom command bar that
 * expands upward — never a floating window.
 */
import { type ReactNode } from "react";

export default function StudioShell({
  taskbar,
  rail,
  stage,
  inspector,
  littLayer,
  leftPanel,
  dockHandle,
}: {
  /** Task strip — the durable task tabs (WorktabBar). */
  taskbar: ReactNode;
  /** Left workspace rail. */
  rail: ReactNode;
  /** Central stage — the active workspace surface. */
  stage: ReactNode;
  /** Right contextual inspector. */
  inspector: ReactNode;
  /** Bottom LiTT command layer (null when the chat is left-docked). */
  littLayer: ReactNode;
  /** Left-docked LiTT panel (null when the chat is bottom-docked). */
  leftPanel?: ReactNode;
  /** Resize handle between the left panel and the rail. */
  dockHandle?: ReactNode;
}) {
  return (
    <div
      className="studio-shell flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="studio-shell"
    >
      {taskbar}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {leftPanel}
        {dockHandle}
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
