"use client";

import { useAuth } from "@clerk/nextjs";
import { useState, useEffect } from "react";

export function useClerkAuth() {
  const clerk = useAuth();
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    name: string | null;
    email: string;
  } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    // If Clerk already says signed in, no need to check custom session
    if (clerk.isSignedIn) {
      const id = requestAnimationFrame(() => setSessionLoaded(true));
      return () => cancelAnimationFrame(id);
    }
    // If Clerk is still loading, wait
    if (!clerk.isLoaded) return;

    // Clerk loaded and not signed in — check custom JWT session
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setSessionUser({
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
          });
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
  const sessionClaims:
    | { name?: string | null; username?: string | null }
    | undefined =
    (clerk.sessionClaims as
      | { name?: string | null; username?: string | null }
      | undefined) ||
    (sessionUser
      ? { name: sessionUser.name, username: sessionUser.email }
      : undefined);

  return { ...clerk, isLoaded, isSignedIn, userId, sessionClaims };
}
