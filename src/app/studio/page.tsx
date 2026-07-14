"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import dynamicImport from "next/dynamic";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { Lock, Sparkles, Terminal, Loader2 } from "lucide-react";

const StudioOS = dynamicImport(() => import("./components/StudioOS"), {
  ssr: false,
});

function StudioHub() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { tokens } = useTheme();

  if (!isLoaded) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative">
            <div
              className="absolute inset-0 animate-ping rounded-full opacity-20"
              style={{ backgroundColor: tokens.primary }}
            />
            <div
              className="relative flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                backgroundColor: `${tokens.primary}15`,
                border: `1px solid ${tokens.primary}30`,
              }}
            >
              <Terminal size={20} style={{ color: tokens.primary }} />
            </div>
          </div>
          <div className="text-center">
            <div
              className="text-xs font-black uppercase tracking-widest"
              style={{ color: tokens.textMuted }}
            >
              Initializing Studio
            </div>
            <div className="mt-1 flex items-center justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1 w-1 rounded-full animate-pulse"
                  style={{
                    backgroundColor: tokens.primary,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 30%, ${tokens.primary}22 0%, transparent 45%), radial-gradient(circle at 70% 70%, #a855f722 0%, transparent 40%)`,
          }}
        />
        <div
          className="relative max-w-sm w-full rounded-2xl border p-8 text-center"
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
          <div
            className="mb-1 text-base font-black"
            style={{ color: tokens.text }}
          >
            Studio is member-only
          </div>
          <div
            className="mb-6 text-xs leading-relaxed"
            style={{ color: tokens.textMuted }}
          >
            Sign in to access your AI crew, projects, and creative workspace.
          </div>
          <Link
            href="/sign-in?redirect_url=/studio"
            className="mb-3 flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-black transition hover:opacity-90 hover:scale-[1.02]"
            style={{
              backgroundColor: tokens.primary,
              boxShadow: `0 0 20px ${tokens.primary}40`,
            }}
          >
            <Sparkles size={14} /> Sign in to Studio
          </Link>
          <Link
            href="/sign-up"
            className="flex items-center justify-center gap-1 rounded-xl border px-5 py-2.5 text-xs font-bold transition hover:opacity-70"
            style={{ borderColor: tokens.border, color: tokens.textMuted }}
          >
            Create free account
          </Link>
        </div>
      </div>
    );
  }

  return <StudioOS />;
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
          <div className="flex flex-col items-center gap-4">
            <Loader2
              size={24}
              className="animate-spin"
              style={{ color: tokens.primary }}
            />
            <span
              className="text-xs font-black uppercase tracking-widest"
              style={{ color: tokens.textMuted }}
            >
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
