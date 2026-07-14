"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuthHook } from "@clerk/nextjs";

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  sessionClaims: { name?: string | null; username?: string | null } | undefined;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  redirectToSignIn: () => void;
  redirectToSignUp: () => void;
}

const DEFAULT_AUTH: AuthState = {
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  sessionClaims: undefined,
  getToken: async () => null,
  signOut: async () => {},
  redirectToSignIn: () => {},
  redirectToSignUp: () => {},
};

const ClerkAuthContext = createContext<AuthState>(DEFAULT_AUTH);

function ClerkAuthInner({ children }: { children: ReactNode }) {
  const clerk = useClerkAuthHook();
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    name: string | null;
    email: string;
  } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    if (clerk.isSignedIn) {
      const id = requestAnimationFrame(() => setSessionLoaded(true));
      return () => cancelAnimationFrame(id);
    }
    if (!clerk.isLoaded) return;

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

  const value: AuthState = {
    isLoaded,
    isSignedIn,
    userId,
    sessionClaims,
    getToken: clerk.getToken ?? (async () => null),
    signOut: clerk.signOut ?? (async () => {}),
    redirectToSignIn: () => {},
    redirectToSignUp: () => {},
  };

  return (
    <ClerkAuthContext.Provider value={value}>
      {children}
    </ClerkAuthContext.Provider>
  );
}

function NoClerkAuth({ children }: { children: ReactNode }) {
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    name: string | null;
    email: string;
  } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
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
  }, []);

  const value: AuthState = {
    isLoaded: sessionLoaded,
    isSignedIn: !!sessionUser,
    userId: sessionUser?.id ?? null,
    sessionClaims: sessionUser
      ? { name: sessionUser.name, username: sessionUser.email }
      : undefined,
    getToken: async () => null,
    signOut: async () => {},
    redirectToSignIn: () => {},
    redirectToSignUp: () => {},
  };

  return (
    <ClerkAuthContext.Provider value={value}>
      {children}
    </ClerkAuthContext.Provider>
  );
}

export function ClerkAuthContextProvider({
  clerkAvailable,
  children,
}: {
  clerkAvailable: boolean;
  children: ReactNode;
}) {
  if (clerkAvailable) {
    return <ClerkAuthInner>{children}</ClerkAuthInner>;
  }
  return <NoClerkAuth>{children}</NoClerkAuth>;
}

export function useClerkAuthContext() {
  return useContext(ClerkAuthContext);
}
