"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";

/** Keeps auth-only navigation client-side without hydrating the landing page. */
export default function HomeAuthRedirect() {
  const { isSignedIn: clerkSignedIn, isLoaded: clerkLoaded } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (clerkLoaded && clerkSignedIn) {
      router.replace("/studio");
    }
  }, [clerkLoaded, clerkSignedIn, router]);

  return null;
}
