"use client";

/**
 * UserEnsureContext — guarantees the backend user/wallet record exists
 * immediately after the client detects an authenticated Clerk session.
 *
 * Problem:
 *   Clerk fires a `user.created` webhook to /api/webhook/clerk on signup,
 *   which calls getOrCreateUser(). But webhooks are async — the user may
 *   land on /dashboard before the Supabase row exists, causing wallet
 *   fetches and project queries to fail silently.
 *
 * Solution:
 *   On first detection of `isSignedIn === true`, call POST /api/user/ensure
 *   (which calls getOrCreateUser server-side with the Clerk session token).
 *   Retry up to 3 times with 1s/2s/4s backoff. The result (`isNew`) is
 *   exposed so the dashboard can show a first-run welcome banner.
 *
 * This is NOT a second onboarding state machine — it is a reliability
 * layer that ensures the existing backend initialization (getOrCreateUser)
 * has been invoked before the user interacts with the app.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

export type UserEnsureState = {
  /** true while the ensure call is in-flight or retrying */
  ensuring: boolean;
  /** true when the ensure call succeeded (user + wallet exist in backend) */
  ensured: boolean;
  /** true when the backend reported this is a brand-new user */
  isNew: boolean;
  /** error message if the ensure call failed after all retries */
  error: string | null;
  /** manually retry the ensure call */
  retry: () => void;
};

const DEFAULT_STATE: UserEnsureState = {
  ensuring: false,
  ensured: false,
  isNew: false,
  error: null,
  retry: () => {},
};

const UserEnsureContext = createContext<UserEnsureState>(DEFAULT_STATE);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export function UserEnsureProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [ensuring, setEnsuring] = useState(false);
  const [ensured, setEnsured] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);
  const ensuredRef = useRef(false);
  const isSignedInRef = useRef(isSignedIn);
  const retryTriggerRef = useRef(0);

  // Keep ref in sync so the effect closure sees the latest value
  isSignedInRef.current = isSignedIn;

  const doEnsure = useCallback(async () => {
    if (ensuredRef.current) return;
    setEnsuring(true);
    setError(null);

    const attempt = attemptRef.current;
    try {
      const res = await fetch("/api/user/ensure", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Ensure failed: ${res.status}`);
      }

      const data = await res.json();
      ensuredRef.current = true;
      setEnsured(true);
      setIsNew(Boolean(data.isNew));
      setEnsuring(false);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (attempt < MAX_RETRIES - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        setTimeout(() => {
          attemptRef.current += 1;
          void doEnsure();
        }, delay);
        return;
      }
      // All retries exhausted
      setEnsuring(false);
      setError(msg);
    }
  }, []);

  // Fire ensure when auth first becomes signed-in
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (ensuredRef.current) return;
    attemptRef.current = 0;
    void doEnsure();
  }, [isLoaded, isSignedIn, doEnsure, retryTriggerRef.current]);

  // Reset state when user signs out
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      ensuredRef.current = false;
      setEnsured(false);
      setIsNew(false);
      setError(null);
      setEnsuring(false);
      attemptRef.current = 0;
    }
  }, [isLoaded, isSignedIn]);

  const retry = useCallback(() => {
    if (ensuredRef.current) return;
    attemptRef.current = 0;
    setError(null);
    retryTriggerRef.current += 1;
    void doEnsure();
  }, [doEnsure]);

  return (
    <UserEnsureContext.Provider
      value={{ ensuring, ensured, isNew, error, retry }}
    >
      {children}
    </UserEnsureContext.Provider>
  );
}

export function useUserEnsure(): UserEnsureState {
  return useContext(UserEnsureContext);
}
