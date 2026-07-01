"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import { useClerkAuth } from "@/hooks/useClerkAuth";

export default function AuthRedirect() {
  const { isSignedIn: supabaseSignedIn } = useSupabaseAuthHook();
  const { isSignedIn: clerkSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (supabaseSignedIn || clerkSignedIn) {
      router.replace("/dashboard");
    }
  }, [supabaseSignedIn, clerkSignedIn, router]);

  return null;
}
