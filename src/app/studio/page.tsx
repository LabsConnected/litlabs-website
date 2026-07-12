"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { LiTTTerminalPage } from "@/components/litt-terminal/LiTTTerminalPage";
import { Loader2, Lock } from "lucide-react";

function StudioHub() {
  const { isLoaded, isSignedIn } = useClerkAuth();
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
            Loading Studio
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
            Sign in to open Studio
          </div>
          <Link
            href="/sign-in?redirect_url=/studio"
            className="rounded-lg px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90"
            style={{ backgroundColor: tokens.primary }}
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return <LiTTTerminalPage />;
}

export default function StudioPage() {
  const { tokens } = useTheme();

  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center p-6"
          style={{
            backgroundColor: tokens.background,
            color: tokens.textMuted,
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2
              size={24}
              className="animate-spin"
              style={{ color: tokens.primary }}
            />
            <span className="text-xs font-bold uppercase tracking-wider">
              Loading Studio
            </span>
          </div>
        </div>
      }
    >
      <StudioHub />
    </Suspense>
  );
}
