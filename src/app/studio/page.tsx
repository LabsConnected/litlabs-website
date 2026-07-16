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
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#030308] p-6">
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
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#030308] p-6">
        <div className="relative flex flex-col items-center gap-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" />
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500/15 border border-cyan-500/30">
              <Lock size={22} style={{ color: T.accentColor }} />
            </div>
          </div>
          <div>
            <h1
              className="text-lg font-black tracking-tight"
              style={{ color: T.headerColor }}
            >
              Studio Access Required
            </h1>
            <p
              className="mt-1.5 text-xs max-w-xs"
              style={{ color: T.textMuted }}
            >
              Sign in to access the full Studio — code, agents, image gen,
              terminal, pipelines, and more.
            </p>
          </div>
          <Link
            href="/sign-in?redirect_url=/studio"
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-[1.03] active:scale-[0.98]"
            style={{
              backgroundColor: T.accentColor,
              color: "#fff",
            }}
          >
            <Sparkles size={15} />
            Sign In to Studio
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
        <div className="min-h-dvh grid place-items-center bg-[#030308]">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
        </div>
      }
    >
      <StudioHub />
    </Suspense>
  );
}