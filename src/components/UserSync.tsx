"use client";

import { useEffect } from "react";

const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const clerkAvailable =
  (CLERK_KEY.startsWith("pk_test_") || CLERK_KEY.startsWith("pk_live_")) &&
  CLERK_KEY.length > 40;

/**
 * Syncs user identity to the database on mount.
 * Only active when Clerk auth is configured; silent no-op otherwise.
 */
export default function UserSync() {
  // Guard: only run when Clerk is properly configured
  if (!clerkAvailable) return null;

  // Dynamically require Clerk hooks to avoid breaking when unconfigured
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { useAuth } = require("@clerk/nextjs");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { isSignedIn, userId } = useAuth();

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    fetch("/api/account", { method: "GET" })
      .then((res) => {
        if (!res.ok) console.warn("[UserSync] Account sync failed:", res.status);
      })
      .catch(() => {
        // Silent fail — webhook will handle it later
      });
  }, [isSignedIn, userId]);

  return null;
}
