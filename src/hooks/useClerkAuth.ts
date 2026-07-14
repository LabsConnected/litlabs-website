"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type SessionUser = { id: string; name: string | null; email: string };

export type AppUser = {
  id: string;
  firstName: string | null;
  fullName: string | null;
  username: string | null;
  imageUrl: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  publicMetadata: Record<string, unknown>;
};

function useCustomSession() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.user) {
          setSessionUser({
            id: data.user.id,
            name: data.user.name ?? null,
            email: data.user.email ?? "",
          });
        }
        setIsLoaded(true);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setIsLoaded(true);
      });
    return () => controller.abort();
  }, []);

  return { sessionUser, isLoaded };
}

function useConfiguredAuth() {
  const clerk = useAuth();
  return {
    ...clerk,
    isLoaded: clerk.isLoaded,
    isSignedIn: Boolean(clerk.isSignedIn),
    userId: clerk.userId,
    sessionClaims: clerk.sessionClaims as
      | { name?: string | null; username?: string | null }
      | undefined,
  };
}

function useSessionAuth() {
  const { sessionUser, isLoaded } = useCustomSession();
  return {
    isLoaded,
    isSignedIn: Boolean(sessionUser),
    userId: sessionUser?.id ?? null,
    sessionClaims: sessionUser
      ? { name: sessionUser.name, username: sessionUser.email }
      : undefined,
  };
}

export const useClerkAuth = clerkConfigured ? useConfiguredAuth : useSessionAuth;

function useConfiguredUser() {
  const { user, isLoaded } = useUser();
  const appUser: AppUser | null = user
    ? {
        id: user.id,
        firstName: user.firstName,
        fullName: user.fullName,
        username: user.username,
        imageUrl: user.imageUrl,
        primaryEmailAddress: user.primaryEmailAddress
          ? { emailAddress: user.primaryEmailAddress.emailAddress }
          : null,
        publicMetadata: user.publicMetadata,
      }
    : null;
  return { user: appUser, isLoaded };
}

function useSessionUser() {
  const { sessionUser, isLoaded } = useCustomSession();
  const user: AppUser | null = sessionUser
    ? {
        id: sessionUser.id,
        firstName: sessionUser.name?.split(" ")[0] ?? null,
        fullName: sessionUser.name,
        username: sessionUser.email.split("@")[0] || null,
        imageUrl: null,
        primaryEmailAddress: sessionUser.email
          ? { emailAddress: sessionUser.email }
          : null,
        publicMetadata: {},
      }
    : null;
  return { user, isLoaded };
}

export const useAppUser = clerkConfigured ? useConfiguredUser : useSessionUser;
