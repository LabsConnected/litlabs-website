"use client";

/**
 * DiscoverHero — the LiTTAppShell header slot for /discover.
 *
 * Presentation only (Phase 1 audit §4: the hero banner is SUPPORTED
 * as a visual). It carries the page's existing live header (live dot
 * + title + LIVE label, previously hand-rolled in page.tsx) and the
 * quick-action row. Every quick action wires into the EXISTING
 * Composer through the page's focus-request callback — focus plus an
 * initial mode; no second composer, no new posting path:
 *   - Create a Post → text mode       - Share a Link → link mode
 *   - Start a Poll  → poll mode       - Upload Project → project mode
 * (Project mode's attachment chain has a pre-existing contract bug,
 * audit §3.4, held for a separate backend decision — this button only
 * opens the same project mode the composer's own buttons open.)
 *
 * No stats, counts, or claims are rendered here: none have an honest
 * source.
 */

import { PenLine, Link2, BarChart3, FolderGit2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { ComposerType } from "@/components/feed/Composer";

const QUICK_ACTIONS: { mode: ComposerType; label: string; icon: typeof PenLine }[] = [
  { mode: "text", label: "Create a Post", icon: PenLine },
  { mode: "link", label: "Share a Link", icon: Link2 },
  { mode: "poll", label: "Start a Poll", icon: BarChart3 },
  { mode: "project", label: "Upload Project", icon: FolderGit2 },
];

export default function DiscoverHero({
  isSignedIn,
  onQuickAction,
}: {
  isSignedIn: boolean;
  onQuickAction: (mode: ComposerType) => void;
}) {
  const { tokens } = useTheme();

  return (
    <div
      className="mb-5 rounded-2xl border p-4 sm:p-5"
      style={{
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
      }}
    >
      <div className="flex min-h-[44px] flex-wrap items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: tokens.success }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: tokens.success }}
          />
        </span>
        <h1
          className="text-xl font-bold tracking-tight"
          style={{ color: tokens.text }}
        >
          Discover
        </h1>
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: tokens.textMuted }}
        >
          Live
        </span>
      </div>
      <p
        className="mt-1 text-sm leading-relaxed"
        style={{ color: tokens.textMuted }}
      >
        See what the community is building — and share your own work.
      </p>

      {isSignedIn && (
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_ACTIONS.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onQuickAction(mode)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold"
              style={{
                borderColor: tokens.border,
                color: tokens.text,
                backgroundColor: tokens.surfaceElevated,
              }}
            >
              <Icon size={15} aria-hidden style={{ color: tokens.primary }} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
