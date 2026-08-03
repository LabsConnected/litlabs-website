"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import VisualHarnessContent from "./VisualHarnessContent";
import { Lock, Loader2 } from "lucide-react";

function VisualHarnessGuard() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { tokens } = useTheme();

  if (!isLoaded) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={24} className="animate-spin" style={{ color: tokens.primary }} />
          <span
            className="text-xs font-black uppercase tracking-widest"
            style={{ color: tokens.textMuted }}
          >
            Loading Visual Harness
          </span>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div
          className="max-w-sm w-full rounded-2xl border p-8 text-center"
          style={{
            backgroundColor: tokens.surface,
            borderColor: `${tokens.primary}20`,
          }}
        >
          <div
            className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: `${tokens.primary}12`,
              boxShadow: `0 0 32px ${tokens.primary}25`,
            }}
          >
            <Lock size={28} style={{ color: tokens.primary }} />
          </div>
          <div className="mb-1 text-base font-black" style={{ color: tokens.text }}>
            Visual Harness is member-only
          </div>
          <div className="mb-6 text-xs leading-relaxed" style={{ color: tokens.textMuted }}>
            Sign in to access the Studio visual verification harness.
          </div>
          <Link
            href="/sign-in?redirect_url=/studio/visual-test"
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-black transition-all hover:opacity-90"
            style={{
              backgroundColor: tokens.primary,
              boxShadow: `0 0 20px ${tokens.primary}40`,
            }}
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return <VisualHarnessContent />;
}

export default function VisualHarnessPage() {
  const { tokens } = useTheme();

  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center p-6"
          style={{ backgroundColor: tokens.background, color: tokens.textMuted }}
        >
          <Loader2 size={24} className="animate-spin" style={{ color: tokens.primary }} />
        </div>
      }
    >
      <VisualHarnessGuard />
    </Suspense>
  );
}
