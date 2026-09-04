"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * Fires signup_started when the sign-up page mounts.
 * signup_completed is tracked via Clerk's onCompleted callback
 * (wired in the SignUp component where supported, or via
 * the redirect to /studio which triggers studio_opened).
 */
export function SignupTracker() {
  useEffect(() => {
    track("signup_started", { source: "signup_page" });
  }, []);
  return null;
}
