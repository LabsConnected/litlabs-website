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
 * LiTT is shell chrome. It docks either as the bottom command layer
 * (littLayer) or as a persistent left panel (littDock) — exactly one
 * of the two renders at a time; the other slot receives null.
 */
import { type ReactNode } from "react";

export default function StudioShell({
  taskbar,
  rail,
  stage,
  inspector,
  littLayer,
  littDock,
}: {
  /** Task strip — the durable task tabs (WorktabBar). */
  taskbar: ReactNode;
  /** Left workspace rail. */
  rail: ReactNode;
  /** Central stage — the active workspace surface. */
  stage: ReactNode;
  /** Right contextual inspector. */
  inspector: ReactNode;
  /** Bottom LiTT command layer (null when the chat is docked left). */
  littLayer: ReactNode;
  /** Optional persistent left LiTT dock panel + its resize handle.
      Undefined when the chat is docked bottom — the middle row then
      renders byte-for-byte as before. */
  littDock?: ReactNode;
}) {
  return (
    <div
      className="studio-shell flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="studio-shell"
    >
      {taskbar}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {littDock}
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
