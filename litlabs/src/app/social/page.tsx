"use client";
export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import SocialPageContent from "@/components/SocialPageContent";

export default function SocialPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/social");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] text-cyan-400 font-mono">
        <div className="text-center">
          <div className="text-2xl mb-2 animate-pulse">▓▒░</div>
          <div className="text-xs opacity-50">SYSTEM_INIT...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] text-white/60">
        <div className="text-center">
          <div className="text-3xl mb-4">🔒</div>
          <div>Sign in to join the social feed.</div>
        </div>
      </div>
    );
  }

  return <SocialPageContent />;
}
