"use client";

/**
 * LiTT Base Station — AgentsPageClient
 *
 * Thin entry point: reads the Clerk auth state, redirects to /sign-in if
 * the user isn't signed in, and renders the `BaseStationShell`. All the
 * actual Base Station logic lives in the components/ tree.
 *
 * (Phase 1 left the file in place with the legacy "crew + mission
 * composer" UI; Phase 4 replaces that with a single render of the new
 * shell. The legacy code was archived in git history.)
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import BaseStationShell from "./components/BaseStationShell";

export default function AgentsPageClient() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useClerkAuth();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/agents");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <p className="text-sm opacity-60">Loading Base Station…</p>
      </div>
    );
  }

  return <BaseStationShell />;
}
