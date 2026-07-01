"use client";

import { useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

/**
 * Syncs user identity to the database on mount.
 * Primary: GET /api/account. Backup: POST /api/user/ensure if primary fails.
 */
export default function UserSync() {
  const { isSignedIn, userId } = useClerkAuth();

  useEffect(() => {
    if (!isSignedIn || !userId) return;

    fetch("/api/account", { method: "GET" })
      .then(async (res) => {
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.isNew) {
          try { localStorage.setItem("litlabs-new-user", "1"); } catch { /* ignore */ }
        }
        // If account sync failed or returned not-synced, fire ensure as backup
        if (!res.ok || !data?.synced) {
          fetch("/api/user/ensure", { method: "POST" }).catch(() => {});
        }
      })
      .catch(() => {
        // Primary failed — try ensure as fallback
        fetch("/api/user/ensure", { method: "POST" }).catch(() => {});
      });
  }, [isSignedIn, userId]);

  return null;
}
