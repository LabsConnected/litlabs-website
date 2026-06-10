"use client";

import { useAuth } from "@clerk/nextjs";

const FALLBACK = { isLoaded: true, isSignedIn: false, userId: null as string | null };

export function useClerkAuth() {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const auth = useAuth();
    return auth;
  } catch {
    return FALLBACK;
  }
}
