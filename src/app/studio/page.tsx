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
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#030308] p-6">
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" />
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/15 border border-cyan-500/30">
              <Terminal size={20} style={{ color: T.accentColor }} />
            </div>
          </div>
          <div className="text-center">
            <div
              className="text-xs font-black uppercase tracking-widest"
              style={{ color: T.textMuted }}
            >
              Initializing Studio
            </div>
            <div className="mt-1 flex items-center justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1 w-1 rounded-full animate-pulse bg-cyan-400"
                  style={{ animationDelay: `${i * 150}ms` }}
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
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#030308] p-6">
        <div className="relative max-w-sm w-full rounded-2xl border border-white/5 bg-[#05050a] p-8 text-center">
          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10 shadow-[0_0_32px_rgba(34,211,238,0.15)]">
            <Lock size={28} style={{ color: T.accentColor }} />
          </div>
          <div
            className="mb-1 text-base font-black"
            style={{ color: T.textColor }}
          >
            Studio is member-only
          </div>
          <div
            className="mb-6 text-xs leading-relaxed"
            style={{ color: T.textMuted }}
          >
            Sign in to access your AI crew, projects, and creative workspace.
          </div>
          <Link
            href="/sign-in?redirect_url=/studio"
            className="mb-3 flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-black shadow-[0_0_20px_rgba(34,211,238,0.25)] transition hover:opacity-90 hover:scale-[1.02]"
            style={{ backgroundColor: T.accentColor }}
          >
            <Sparkles size={14} /> Sign in to Studio
          </Link>
          <Link
            href="/sign-up"
            className="flex items-center justify-center gap-1 rounded-xl border border-white/10 px-5 py-2.5 text-xs font-bold transition hover:bg-white/10"
            style={{ color: T.textMuted }}
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
  const { resolvedColors: T } = useTheme();
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center bg-[#030308] p-6"
          style={{ color: T.textMuted }}
        >
          <div className="flex flex-col items-center gap-4">
            <Loader2
              size={24}
              className="animate-spin"
              style={{ color: T.accentColor }}
            />
            <span
              className="text-xs font-black uppercase tracking-widest"
              style={{ color: T.textMuted }}
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
