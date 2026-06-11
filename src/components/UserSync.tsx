"use client";

import { useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

/**
 * Syncs user identity to the database on mount.
 * Only active when Clerk auth is configured; silent no-op otherwise.
 */
export default function UserSync() {
  const { isSignedIn, userId } = useClerkAuth();

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    fetch("/api/account", { method: "GET" })
      .then((res) => {
        if (!res.ok) {/* UserSync account sync failed */}
      })
      .catch(() => {
        // Silent fail — webhook will handle it later
      });
  }, [isSignedIn, userId]);

  return null;
}
