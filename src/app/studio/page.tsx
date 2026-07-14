"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import dynamicImport from "next/dynamic";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Lock, Sparkles, Terminal, Loader2 } from "lucide-react";

const StudioOS = dynamicImport(() => import("./components/StudioOS"), {
  ssr: false,
});

function StudioHub() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#030308] p-6">
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" />
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/15 border border-cyan-500/30">
              <Terminal size={20} className="text-cyan-400" />
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-widest text-neutral-400">
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
            <Lock size={28} className="text-cyan-400" />
          </div>
          <div className="mb-1 text-base font-black text-white">
            Studio is member-only
          </div>
          <div className="mb-6 text-xs leading-relaxed text-neutral-400">
            Sign in to access your AI crew, projects, and creative workspace.
          </div>
          <Link
            href="/sign-in?redirect_url=/studio"
            className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-black text-black shadow-[0_0_20px_rgba(34,211,238,0.25)] transition hover:opacity-90 hover:scale-[1.02]"
          >
            <Sparkles size={14} /> Sign in to Studio
          </Link>
          <Link
            href="/sign-up"
            className="flex items-center justify-center gap-1 rounded-xl border border-white/10 px-5 py-2.5 text-xs font-bold text-neutral-400 transition hover:opacity-70"
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
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#030308] p-6 text-neutral-400">
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={24} className="animate-spin text-cyan-400" />
            <span className="text-xs font-black uppercase tracking-widest text-neutral-400">
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
