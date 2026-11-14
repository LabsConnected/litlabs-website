"use client";

/**
 * DiscoverSidebar — the LiTTAppShell sidebar content for /discover.
 *
 * Honesty rules from the Phase 1 audit (§4) govern what appears here:
 *   - For You / Following / Trending are REAL feed tabs; they drive
 *     the same FeedTab state as the feed's own tab bar (via the Feed
 *     handle in the page) — one source of truth, never a second query.
 *   - Following is only personalized for signed-in users (signed-out
 *     it silently degrades to the public For You query), so signed-out
 *     visitors get a sign-in link instead of a tab button that would
 *     pretend to be personal.
 *   - Projects and Showcase are plain route links to real pages.
 *   - Concept items from the mockup (Featured feed, Templates,
 *     Collections, Creators, News & Updates, Challenges, Guides) are
 *     NOT rendered: they have no backend source today.
 *
 * The "Share your build" card wires into the existing Composer via
 * the page's quick-action callback — it does not create a second
 * composer or a new posting path.
 */

import Link from "next/link";
import {
  Sparkles,
  Users,
  Flame,
  FolderGit2,
  LayoutGrid,
  Lock,
  PenLine,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import type { FeedTab } from "@/components/feed/types";
import type { ComposerType } from "@/components/feed/Composer";

const FEED_ITEMS: { id: FeedTab; label: string; icon: typeof Sparkles }[] = [
  { id: "for-you", label: "For You", icon: Sparkles },
  { id: "following", label: "Following", icon: Users },
  { id: "trending", label: "Trending", icon: Flame },
];

function SectionLabel({ children }: { children: string }) {
  const { tokens } = useTheme();
  return (
    <p
      className="px-2 text-[10px] font-black uppercase tracking-[0.2em]"
      style={{ color: tokens.textMuted }}
    >
      {children}
    </p>
  );
}

export default function DiscoverSidebar({
  activeTab,
  isSignedIn,
  onSelectTab,
  onQuickAction,
}: {
  activeTab: FeedTab;
  isSignedIn: boolean;
  onSelectTab: (tab: FeedTab) => void;
  onQuickAction: (mode: ComposerType) => void;
}) {
  const { tokens } = useTheme();

  const itemClass =
    "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm transition-colors";
  const captionClass = "block text-xs font-normal";

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Discover feed">
        <SectionLabel>Feed</SectionLabel>
        <div className="mt-2 flex flex-col gap-1">
          {FEED_ITEMS.map(({ id, label, icon: Icon }) => {
            if (id === "following" && !isSignedIn) {
              // Signed-out Following is not personalized (it degrades
              // to the public query server-side) — offer sign-in
              // instead of presenting it as the user's own feed.
              return (
                <Link
                  key={id}
                  href="/sign-in?redirect_url=/discover"
                  className={itemClass}
                  style={{ color: tokens.textMuted }}
                >
                  <Lock size={17} aria-hidden />
                  <span>
                    {label}
                    <span className={captionClass}>Sign in to follow creators</span>
                  </span>
                </Link>
              );
            }
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTab(id)}
                aria-current={active ? "page" : undefined}
                className={cn(itemClass, active ? "font-bold" : "font-medium")}
                style={{
                  color: active ? tokens.text : tokens.textMuted,
                  backgroundColor: active ? `${tokens.primary}14` : "transparent",
                }}
              >
                <Icon
                  size={17}
                  aria-hidden
                  style={{ color: active ? tokens.primary : undefined }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      <nav aria-label="Explore">
        <SectionLabel>Explore</SectionLabel>
        <div className="mt-2 flex flex-col gap-1">
          <Link
            href="/projects"
            className={itemClass}
            style={{ color: tokens.textMuted }}
          >
            <FolderGit2 size={17} aria-hidden />
            <span>
              Projects
              <span className={captionClass}>Your project workspaces</span>
            </span>
          </Link>
          <Link
            href="/showcase"
            className={itemClass}
            style={{ color: tokens.textMuted }}
          >
            <LayoutGrid size={17} aria-hidden />
            <span>
              Showcase
              <span className={captionClass}>Featured projects and architecture</span>
            </span>
          </Link>
        </div>
      </nav>

      {isSignedIn && (
        <div
          className="rounded-2xl border p-4"
          style={{
            backgroundColor: tokens.surfaceElevated,
            borderColor: tokens.border,
          }}
        >
          <p className="text-sm font-bold" style={{ color: tokens.text }}>
            Share your build
          </p>
          <p
            className="mt-1 text-xs leading-relaxed"
            style={{ color: tokens.textMuted }}
          >
            Post an update on what you are making and put it in front of
            the community.
          </p>
          <button
            type="button"
            onClick={() => onQuickAction("text")}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-bold"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.textInverse,
            }}
          >
            <PenLine size={15} aria-hidden />
            Create a post
          </button>
        </div>
      )}
    </div>
  );
}
