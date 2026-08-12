"use client";

import { useClerkAuthContext } from "@/context/ClerkAuthContext";

export type AppUser = {
  id: string;
  firstName: string | null;
  fullName: string | null;
  username: string | null;
  imageUrl: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  publicMetadata: Record<string, unknown>;
};

export function useClerkAuth() {
  const context = useClerkAuthContext();
  return {
    isLoaded: context.isLoaded,
    isSignedIn: context.isSignedIn,
    userId: context.userId,
    sessionClaims: context.sessionClaims,
    getToken: context.getToken,
    signOut: context.signOut,
  };
}

export function useAppUser() {
  const context = useClerkAuthContext();
  return {
    user: context.user,
    isLoaded: context.isLoaded,
  };
}
