"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuthHook, useUser as useClerkUserHook } from "@clerk/nextjs";
import type { AppUser } from "@/hooks/useClerkAuth";

export interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: AppUser | null;
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
  user: null,
  sessionClaims: undefined,
  getToken: async () => null,
  signOut: async () => {},
  redirectToSignIn: () => {},
  redirectToSignUp: () => {},
};

const ClerkAuthContext = createContext<AuthState>(DEFAULT_AUTH);

function ClerkAuthInner({ children }: { children: ReactNode }) {
  const clerk = useClerkAuthHook();
  const { user: clerkUser, isLoaded: userLoaded } = useClerkUserHook();

  let appUser: AppUser | null = null;
  if (clerkUser) {
    appUser = {
      id: clerkUser.id,
      firstName: clerkUser.firstName,
      fullName: clerkUser.fullName,
      username: clerkUser.username,
      imageUrl: clerkUser.imageUrl,
      primaryEmailAddress: clerkUser.primaryEmailAddress
        ? { emailAddress: clerkUser.primaryEmailAddress.emailAddress }
        : null,
      publicMetadata: clerkUser.publicMetadata,
    };
  }

  const value: AuthState = {
    isLoaded: clerk.isLoaded && userLoaded,
    isSignedIn: clerk.isSignedIn === true,
    userId: clerk.userId ?? null,
    user: appUser,
    sessionClaims: clerk.sessionClaims as
      | { name?: string | null; username?: string | null }
      | undefined,
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

function ClerkUnavailableAuth({ children }: { children: ReactNode }) {
  return (
    <ClerkAuthContext.Provider value={DEFAULT_AUTH}>
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
  return <ClerkUnavailableAuth>{children}</ClerkUnavailableAuth>;
}

export function useClerkAuthContext() {
  return useContext(ClerkAuthContext);
}
