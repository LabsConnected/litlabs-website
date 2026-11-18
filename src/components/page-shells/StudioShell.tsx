"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

export type StudioShellLayout = "board" | "classic";

/**
 * StudioShell — truthful loading shell for /studio (Studio entry fix,
 * Larry 2026-11-18: "straight into the studio, either the regular or
 * the board, not some loading type welcome screen thing").
 *
 * The first paint of /studio is the CHOSEN layout's shell, never a
 * centered spinner and never a standalone centered chat:
 *
 *   - board (default): the 52px command header, then the full-window
 *     board area with floating panel placeholders in the default
 *     panels' positions — the Chat panel placeholder anchored
 *     top-center at its seeded geometry (404px wide, 16px from the
 *     top, the BOARD_CHAT anchor), a Preview placeholder center-left,
 *     Files top-right and Media bottom-right. When a project binds,
 *     the real board replaces this skeleton panel for panel, so
 *     nothing visibly jumps or disappears.
 *   - classic (Regular): the same header, then the classic body —
 *     the LiTT chat column on the left in its real in-flow position
 *     and the workspace main (worktab strip + canvas) beside it.
 *
 * Skeleton blocks only — no chat text, project names, or tool output.
 * A single skeleton serving a layout the user did not choose is
 * avoided where the caller knows the choice (page.tsx passes the
 * persisted layout mode); route-level loading.tsx cannot read the
 * persisted choice server-side, so it renders the board shape (the
 * default) — see the entry-fix report.
 */
export default function StudioShell({
  layout = "board",
}: {
  layout?: StudioShellLayout;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className="flex h-full min-h-[calc(100dvh-64px)] w-full flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-main, #05060a)", color: "var(--text-main, #f5f5f7)" }}
      aria-label="Loading Studio"
      data-testid="studio-shell"
      data-layout={layout}
    >
      {/* Command header — 52px */}
      <header
        className="flex h-[52px] shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap border-b px-3 sm:gap-2 sm:px-4"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
        data-testid="studio-shell-header"
      >
        <div aria-hidden="true" className="flex shrink-0 items-center gap-2">
          <Shimmer className="!rounded-full" width={28} height={28} />
          <Shimmer width={120} height={16} />
        </div>
        <div className="flex-1" aria-hidden="true" />
        <Shimmer width={64} height={28} rounded="rounded-lg" />
        <Shimmer width={28} height={28} rounded="rounded-lg" />
        <Shimmer width={28} height={28} rounded="rounded-lg" />
      </header>

      {layout === "classic" ? (
        /* Classic / Regular body: chat column in flow on the left,
           workspace main beside it — the chat placeholder sits in the
           exact column the real LiTTPanel occupies. */
        <div
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          data-testid="studio-shell-classic"
        >
          <aside
            className="hidden min-h-0 w-[404px] max-w-[40vw] shrink-0 flex-col border-r lg:flex"
            style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
            data-testid="studio-shell-chat"
          >
            <div
              className="flex shrink-0 gap-1 border-b px-3 py-2"
              style={{ borderColor: tokens.border }}
              aria-hidden="true"
            >
              <Shimmer width={72} height={28} rounded="rounded-full" />
              <Shimmer width={72} height={28} rounded="rounded-full" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3" aria-hidden="true">
              <Shimmer className="self-start" width="72%" height={44} rounded="rounded-2xl" />
              <Shimmer className="self-end" width="58%" height={32} rounded="rounded-2xl" />
              <Shimmer className="self-start" width="80%" height={56} rounded="rounded-2xl" />
              <Shimmer className="self-start" width="48%" height={32} rounded="rounded-2xl" />
            </div>
            <div
              className="flex shrink-0 items-center gap-2 border-t p-3"
              style={{ borderColor: tokens.border }}
              aria-hidden="true"
            >
              <Shimmer className="flex-1" height={48} rounded="rounded-xl" />
              <Shimmer className="!rounded-full" width={40} height={40} />
            </div>
          </aside>

          <main
            className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden"
            data-testid="studio-shell-workspace"
          >
            <div
              className="flex h-[36px] shrink-0 items-center gap-0.5 border-b px-2"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
              aria-hidden="true"
            >
              {[0, 1, 2].map((i) => (
                <Shimmer key={i} width={76} height={24} rounded="rounded-md" />
              ))}
            </div>
            <div className="min-h-0 flex-1 p-4" aria-hidden="true">
              <Shimmer className="h-full w-full" rounded="rounded-xl" />
            </div>
          </main>
        </div>
      ) : (
        /* Board body: one full-window board area; every surface is a
           floating panel placeholder at its default position. */
        <div
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          data-testid="studio-shell-board"
        >
          {/* Preview panel placeholder — center-left default rect. */}
          <div
            className="absolute hidden flex-col overflow-hidden rounded-xl border md:flex"
            style={{
              left: 24,
              top: 72,
              width: "min(700px, 52vw)",
              height: "min(532px, calc(100% - 120px))",
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            }}
            data-testid="studio-shell-panel-preview"
            aria-hidden="true"
          >
            <div
              className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
              style={{ borderColor: tokens.border }}
            >
              <Shimmer width={72} height={14} />
              <div className="flex-1" />
              <Shimmer width={20} height={20} rounded="rounded-md" />
            </div>
            <div className="min-h-0 flex-1 p-3">
              <Shimmer className="h-full w-full" rounded="rounded-lg" />
            </div>
          </div>

          {/* Files panel placeholder — right-top default rect. */}
          <div
            className="absolute hidden flex-col overflow-hidden rounded-xl border xl:flex"
            style={{
              right: 24,
              top: 72,
              width: 360,
              height: 240,
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            }}
            data-testid="studio-shell-panel-files"
            aria-hidden="true"
          >
            <div
              className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
              style={{ borderColor: tokens.border }}
            >
              <Shimmer width={56} height={14} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Shimmer key={i} width={`${82 - i * 9}%`} height={16} />
              ))}
            </div>
          </div>

          {/* Media panel placeholder — right-bottom default rect. */}
          <div
            className="absolute hidden flex-col overflow-hidden rounded-xl border xl:flex"
            style={{
              right: 24,
              bottom: 24,
              width: 360,
              height: 220,
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            }}
            data-testid="studio-shell-panel-media"
            aria-hidden="true"
          >
            <div
              className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
              style={{ borderColor: tokens.border }}
            >
              <Shimmer width={56} height={14} />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 p-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Shimmer key={i} className="h-full w-full" rounded="rounded-lg" />
              ))}
            </div>
          </div>

          {/* Chat panel placeholder — anchored top-center in its real
              board panel slot (seeded rect: centered horizontally,
              16px from the top, 404px wide). It is one panel among
              the board's panels, never a lone centered column. */}
          <div
            className="absolute flex flex-col overflow-hidden rounded-xl border"
            style={{
              left: "50%",
              transform: "translateX(-50%)",
              top: 16,
              width: "min(404px, calc(100vw - 32px))",
              height: "calc(100% - 32px)",
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            }}
            data-testid="studio-shell-chat"
          >
            <div
              className="flex shrink-0 gap-1 border-b px-3 py-2"
              style={{ borderColor: tokens.border }}
              aria-hidden="true"
            >
              <Shimmer width={72} height={28} rounded="rounded-full" />
              <Shimmer width={72} height={28} rounded="rounded-full" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3" aria-hidden="true">
              <Shimmer className="self-start" width="72%" height={44} rounded="rounded-2xl" />
              <Shimmer className="self-end" width="58%" height={32} rounded="rounded-2xl" />
              <Shimmer className="self-start" width="80%" height={56} rounded="rounded-2xl" />
              <Shimmer className="self-start" width="48%" height={32} rounded="rounded-2xl" />
            </div>
            <div
              className="flex shrink-0 items-center gap-2 border-t p-3"
              style={{ borderColor: tokens.border }}
              aria-hidden="true"
            >
              <Shimmer className="flex-1" height={48} rounded="rounded-xl" />
              <Shimmer className="!rounded-full" width={40} height={40} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
