"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import { useClerkAuth } from "@/hooks/useClerkAuth";

export default function AuthRedirect() {
  const { isSignedIn: supabaseSignedIn } = useSupabaseAuthHook();
  const { isSignedIn: clerkSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (supabaseSignedIn || clerkSignedIn) {
      router.replace("/studio?tool=chat");
    }
  }, [supabaseSignedIn, clerkSignedIn, router]);

  return null;
}
