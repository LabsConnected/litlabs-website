"use client";

import { useAuth } from "@clerk/nextjs";

/**
 * /agents is a public catalog. Signed-in users must not be told to
 * "sign in or create an account" (issue #602).
 */
export function AgentsSessionNote() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <p className="mt-3 text-sm text-white/55" data-testid="agents-session-note">
        Checking session…
      </p>
    );
  }

  if (isSignedIn) {
    return (
      <p className="mt-3 text-sm text-white/55" data-testid="agents-session-note">
        You&apos;re signed in. Open agents in Studio to run them with your project
        context and plan entitlements.
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm text-white/55" data-testid="agents-session-note">
      Sign in or create an account to use agents. Availability depends on your
      plan and connected tools.
    </p>
  );
}
