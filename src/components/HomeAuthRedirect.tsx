"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";

/** Keeps auth-only navigation client-side without hydrating the landing page. */
export default function HomeAuthRedirect() {
  const { isSignedIn: clerkSignedIn, isLoaded: clerkLoaded } = useClerkAuth();
  const { isSignedIn: supabaseSignedIn, loading: supabaseLoading } =
    useSupabaseAuthHook();
  const router = useRouter();

  useEffect(() => {
    if (clerkLoaded && !supabaseLoading && (clerkSignedIn || supabaseSignedIn)) {
      router.replace("/studio");
    }
  }, [clerkLoaded, clerkSignedIn, supabaseLoading, supabaseSignedIn, router]);

  return null;
}
