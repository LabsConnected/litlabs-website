"use client";

import { useState } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { Loader2 } from "lucide-react";

/**
 * Follow / Unfollow button for public profiles.
 *
 * Body shapes come straight from src/app/api/follows/route.ts:
 *   POST /api/follows  with JSON { followee_id }
 *   DELETE /api/follows?followee_id=<id>
 *
 * Optimistic with rollback: the toggle flips immediately, and any failed
 * request restores the previous state and surfaces an error. A 409 on
 * follow ("Already following") or 404 on unfollow is treated as success
 * since the end state already matches.
 */
export default function FollowButton({
  targetUserId,
  initialFollowing,
  handle,
  onCountChange,
}: {
  targetUserId: string;
  initialFollowing: boolean;
  handle: string;
  onCountChange?: (delta: 1 | -1) => void;
}) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { tokens } = useTheme();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded) {
    return (
      <div
        className="h-11 w-28 animate-pulse rounded-full"
        style={{ backgroundColor: tokens.surfaceElevated }}
        aria-hidden="true"
      />
    );
  }

  if (!isSignedIn) {
    return (
      <Link
        href={`/sign-in?redirect_url=${encodeURIComponent(`/u/${handle}`)}`}
        className="inline-flex min-h-[44px] items-center justify-center rounded-full px-6 text-sm font-bold"
        style={{
          backgroundColor: tokens.primary,
          color: tokens.textInverse,
        }}
      >
        Follow
      </Link>
    );
  }

  const toggle = async () => {
    if (pending) return;
    const next = !following;
    setPending(true);
    setError(null);
    // Optimistic: flip immediately, roll back on failure.
    setFollowing(next);
    onCountChange?.(next ? 1 : -1);
    try {
      const res = next
        ? await fetch("/api/follows", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ followee_id: targetUserId }),
          })
        : await fetch(
            `/api/follows?followee_id=${encodeURIComponent(targetUserId)}`,
            { method: "DELETE" },
          );
      const alreadyThere =
        (next && res.status === 409) || (!next && res.status === 404);
      if (!res.ok && !alreadyThere) {
        throw new Error(
          next
            ? "Couldn't follow — please try again."
            : "Couldn't unfollow — please try again.",
        );
      }
    } catch (e) {
      // Rollback: restore the confirmed state.
      setFollowing(!next);
      onCountChange?.(next ? -1 : 1);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 text-sm font-bold transition-opacity disabled:opacity-60"
        style={
          following
            ? {
                backgroundColor: tokens.surfaceElevated,
                color: tokens.text,
                border: `1px solid ${tokens.border}`,
              }
            : {
                backgroundColor: tokens.primary,
                color: tokens.textInverse,
              }
        }
      >
        {pending && <Loader2 size={14} className="animate-spin" />}
        {following ? "Following" : "Follow"}
      </button>
      {error && (
        <p className="text-xs" style={{ color: tokens.danger }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
