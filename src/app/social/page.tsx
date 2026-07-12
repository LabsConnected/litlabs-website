"use client";
export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import SocialPageContent from "@/components/SocialPageContent";
import { useTheme } from "@/context/ThemeContext";
import { Loader2, Lock } from "lucide-react";

export default function SocialPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const { tokens } = useTheme();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/social");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: tokens.primary }}
          />
          <span className="text-xs font-bold uppercase tracking-wider">
            Loading social feed
          </span>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Lock size={28} style={{ color: tokens.primary }} />
          <div className="text-sm font-bold" style={{ color: tokens.text }}>
            Sign in to join the social feed
          </div>
        </div>
      </div>
    );
  }

  return <SocialPageContent />;
}
