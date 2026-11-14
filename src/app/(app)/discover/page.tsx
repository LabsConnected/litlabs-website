"use client";
export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { Loader2 } from "lucide-react";
import LiTTAppShell from "@/components/app-shell/LiTTAppShell";
import DiscoverSidebar from "@/components/discover/DiscoverSidebar";
import DiscoverHero from "@/components/discover/DiscoverHero";
import TrendingRail from "@/components/discover/TrendingRail";
import { Composer, type ComposerType } from "@/components/feed/Composer";
import { Feed, type FeedHandle } from "@/components/feed/Feed";
import type { FeedTab, PostDTO } from "@/components/feed/types";

// If the auth provider never reports isLoaded (slow/blocked script,
// network blip), stop spinning after a bound and offer a retry instead
// of hanging indefinitely.
const AUTH_LOAD_TIMEOUT_MS = 8000;

function AuthGateFallback({
  timedOut,
  onRetry,
}: {
  timedOut: boolean;
  onRetry: () => void;
}) {
  const { tokens } = useTheme();
  if (!timedOut) {
    // This fallback is also the server-rendered first paint, so it carries
    // the sign-in invitation itself: a logged-out visitor following a
    // /discover link should see an invitation, not a bare spinner.
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
      >
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: tokens.text }}
          >
            Discover
          </h1>
          <p className="text-sm leading-relaxed">
            The Discover feed is for signed-in members. Sign in to see what
            the community is building — and share your own work.
          </p>
          <Link
            href="/sign-in?redirect_url=/discover"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-5 text-sm font-bold"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.textInverse,
            }}
          >
            Sign in to see the Discover feed
          </Link>
          <span className="mt-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
            <Loader2
              size={14}
              className="animate-spin"
              style={{ color: tokens.primary }}
            />
            Loading discover feed
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-sm" style={{ color: tokens.text }}>
          Discover is taking longer than expected to load.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] rounded-lg border px-4 py-2 text-sm"
          style={{
            borderColor: tokens.border,
            color: tokens.textMuted,
          }}
        >
          Retry
        </button>
        <p className="text-xs">
          Not signed in yet?{" "}
          <Link
            href="/sign-in?redirect_url=/discover"
            className="font-bold underline"
            style={{ color: tokens.primary }}
          >
            Sign in to see the Discover feed
          </Link>
        </p>
      </div>
    </div>
  );
}

function SignedOutCta() {
  const { tokens } = useTheme();
  return (
    <div
      className="mb-3 flex min-h-[44px] flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
      style={{
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
      }}
    >
      <p className="text-sm" style={{ color: tokens.textMuted }}>
        Sign in to share your own posts with the community.
      </p>
      <Link
        href="/sign-in?redirect_url=/discover"
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg px-5 text-sm font-bold"
        style={{
          backgroundColor: tokens.primary,
          color: tokens.textInverse,
        }}
      >
        Sign in
      </Link>
    </div>
  );
}

export default function DiscoverPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { tokens, resolvedColors } = useTheme();
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const feedRef = useRef<FeedHandle | null>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  // Mirror of the Feed's active tab so the sidebar can highlight it.
  // The Feed owns the state; this only follows its onTabChange.
  const [activeTab, setActiveTab] = useState<FeedTab>("for-you");
  const [focusRequest, setFocusRequest] = useState<{
    mode: ComposerType;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (isLoaded || authTimedOut) return;
    const id = setTimeout(() => setAuthTimedOut(true), AUTH_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isLoaded, authTimedOut]);

  // Composer's onPosted hands us the persisted post; prepend it into the
  // feed instantly so the author sees it at the top without a refetch.
  const handlePosted = (post: PostDTO) => {
    feedRef.current?.prependPost(post);
  };

  // Hero quick actions + the sidebar promo: open the existing composer
  // in the requested mode, focused, scrolled into view.
  const handleQuickAction = (mode: ComposerType) => {
    setFocusRequest({ mode, nonce: Date.now() });
    composerWrapRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  if (!isLoaded) {
    return (
      <AuthGateFallback
        timedOut={authTimedOut}
        onRetry={() => {
          // Re-arm the bound so a still-stalled provider surfaces
          // this fallback again, then force a real reload so the
          // auth provider re-initializes from scratch.
          setAuthTimedOut(false);
          window.location.reload();
        }}
      />
    );
  }

  if (!isSignedIn) {
    // Signed-out Discover is a hybrid public path under marketing
    // chrome (LayoutShell): it keeps its established single-column
    // reading layout — the LiTTAppShell frame below is the signed-in
    // app experience and must not reshape the public page.
    return (
      <div className="mx-auto w-full max-w-4xl min-w-0 px-3 pb-28">
        {/* Compact feed header — the app shell already owns navigation. */}
        <header className="flex min-h-[44px] items-center gap-2 py-2">
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
            className="text-lg font-bold tracking-tight"
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
        </header>

        <SignedOutCta />

        <Feed ref={feedRef} initialTab="for-you" />
      </div>
    );
  }

  return (
    <LiTTAppShell
      colors={resolvedColors}
      sidebarLabel="Discover menu"
      sidebar={
        <DiscoverSidebar
          activeTab={activeTab}
          isSignedIn={isSignedIn}
          onSelectTab={(tab) => feedRef.current?.switchTab(tab)}
          onQuickAction={handleQuickAction}
        />
      }
      header={
        <DiscoverHero isSignedIn={isSignedIn} onQuickAction={handleQuickAction} />
      }
      rightRail={<TrendingRail />}
      rightRailLabel="Trending"
    >
      <div className="pb-28">
        <div id="composer" ref={composerWrapRef} className="scroll-mt-4">
          <Composer onPosted={handlePosted} focusRequest={focusRequest} />
        </div>

        <Feed
          ref={feedRef}
          initialTab="for-you"
          onTabChange={setActiveTab}
        />
      </div>
    </LiTTAppShell>
  );
}
