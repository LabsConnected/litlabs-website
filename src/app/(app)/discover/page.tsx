"use client";
export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { Loader2 } from "lucide-react";
import { Composer } from "@/components/feed/Composer";
import { Feed, type FeedHandle } from "@/components/feed/Feed";
import type { PostDTO } from "@/components/feed/types";

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
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: tokens.primary }}
          />
          <span className="text-xs font-bold uppercase tracking-wider">
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
  const { tokens } = useTheme();
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const feedRef = useRef<FeedHandle | null>(null);

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

  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28">
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

      {isSignedIn ? <Composer onPosted={handlePosted} /> : <SignedOutCta />}

      <Feed ref={feedRef} initialTab="for-you" />
    </div>
  );
}
