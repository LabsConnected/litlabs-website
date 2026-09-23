"use client";

import { useTheme } from "@/context/ThemeContext";
import { Shimmer } from "./Shimmer";

/**
 * StudioShell — truthful loading shell for /studio.
 *
 * Mirrors CommandStudio's canvas-first 2-zone layout
 * (src/app/(app)/studio/components/CommandStudio.tsx):
 *   - 52px command header (brand/project, runtime status, action buttons)
 *   - LiTT chat panel (center, 520px default: Chat/Live tabs, message
 *     bubbles, composer) — desktop/laptop only (>=1024px)
 *   - workspace main (36px tab switcher: Design/Code/Preview, canvas area)
 *   - bottom StudioDock tab bar (Files/Terminal/Inspector/Assets/Media)
 *   - mobile bottom nav (Studio/Create/Assets/Agents/Missions/More)
 *
 * Skeleton blocks only — no chat text, project names, or tool output.
 */
export default function StudioShell() {
  const { tokens } = useTheme();

  return (
    <div
      className="flex h-full min-h-[calc(100dvh-64px)] w-full flex-col overflow-hidden"
      style={{ backgroundColor: "var(--bg-main, #05060a)", color: "var(--text-main, #f5f5f7)" }}
      aria-label="Loading Studio"
      data-testid="studio-shell"
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

      {/* Body: LiTT chat panel | workspace canvas zone */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* LiTT panel — desktop/laptop only */}
        <aside
          className="hidden min-h-0 w-[520px] max-w-[40vw] shrink-0 flex-col border-r lg:flex"
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

        {/* Workspace main */}
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

      {/* Bottom StudioDock tab bar */}
      <div
        className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-t pl-2"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
        data-testid="studio-shell-dock"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Shimmer key={i} width={84} height={24} rounded="rounded-md" />
        ))}
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="flex shrink-0 items-center justify-around border-t px-2 py-2 lg:hidden"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
        data-testid="studio-shell-mobile-nav"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <Shimmer className="!rounded-full" width={24} height={24} />
            <Shimmer width={36} height={10} />
          </div>
        ))}
      </nav>
    </div>
  );
}
