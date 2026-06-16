"use client";

import { useAuth } from "@clerk/nextjs";
import { useState, useEffect } from "react";

export function useClerkAuth() {
  const clerk = useAuth();
  const [sessionUser, setSessionUser] = useState<{ id: string } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    // If Clerk already says signed in, no need to check custom session
    if (clerk.isSignedIn) {
      setSessionLoaded(true);
      return;
    }
    // If Clerk is still loading, wait
    if (!clerk.isLoaded) return;

    // Clerk loaded and not signed in — check custom JWT session
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setSessionUser({ id: data.user.id });
        }
        setSessionLoaded(true);
      })
      .catch(() => {
        setSessionLoaded(true);
      });
  }, [clerk.isLoaded, clerk.isSignedIn]);

  const isLoaded = clerk.isLoaded || sessionLoaded;
  const isSignedIn = clerk.isSignedIn || !!sessionUser;
  const userId = clerk.userId || sessionUser?.id || null;

  return { ...clerk, isLoaded, isSignedIn, userId };
}
