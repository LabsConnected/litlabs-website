"use client";
export const dynamic = "force-dynamic";

import { useClerkAuth } from "@/hooks/useClerkAuth";
import SocialPageContent from "@/components/SocialPageContent";
import { useTheme } from "@/context/ThemeContext";
import { Loader2 } from "lucide-react";

export default function SocialPage() {
  const { isLoaded } = useClerkAuth();
  const { tokens } = useTheme();

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

  return <SocialPageContent />;
}
