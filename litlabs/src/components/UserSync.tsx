"use client";

import { useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { getSignupAttribution } from "@/components/SignupAttributionTracker";

// Make this component resilient when Clerk isn't configured or the hook errors


/**
 * Syncs user identity to the database on mount.
 * Primary: GET /api/account. Backup: POST /api/user/ensure if primary fails.
 */
export default function UserSync() {
  const { isSignedIn, userId } = useClerkAuth();

  useEffect(() => {
    // Be defensive: if Clerk isn't configured or hook is still not loaded, do nothing
    try {
      if (!isSignedIn || !userId) return;
    } catch {
      return; // hook threw, bail out
    }

    const attribution = getSignupAttribution();
    const headers: HeadersInit = attribution
      ? { "x-lit-signup-attribution": JSON.stringify(attribution) }
      : {};

    fetch("/api/account", { method: "GET", headers })
      .then(async (res) => {
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.isNew) {
          try { localStorage.setItem("litlabs-new-user", "1"); } catch { /* ignore */ }
        }
        // If account sync failed or returned not-synced, fire ensure as backup
        if (!res.ok || !data?.synced) {
          fetch("/api/user/ensure", { method: "POST", headers }).catch(() => {});
        }
      })
      .catch(() => {
        // Primary failed — try ensure as fallback
        fetch("/api/user/ensure", { method: "POST", headers }).catch(() => {});
      });
  }, [isSignedIn, userId]);

  return null; // renders nothing (headless)
}
