"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";

export default function StudioImagePage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in?redirect_url=/studio?tool=chat");
      return;
    }
    router.replace("/studio?tool=chat");
  }, [isLoaded, isSignedIn, router]);

  return null;
}
