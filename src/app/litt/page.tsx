"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import dynamicImport from "next/dynamic";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Lock, Sparkles, Terminal, Loader2 } from "lucide-react";

const LiTTTerminal = dynamicImport(
  () => import("@/components/dashboard/LiTTTerminal"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-neutral-400">
        <Loader2 size={20} className="animate-spin text-cyan-400" />
      </div>
    ),
  },
);

function ChatHub() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#030308] p-6">
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" />
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/15 border border-cyan-500/30">
              <Terminal size={20} className="text-cyan-400" />
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-widest text-neutral-400">
              Initializing LiTT
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#030308] p-6">
        <div className="relative max-w-sm w-full rounded-2xl border border-white/5 bg-[#05050a] p-8 text-center">
          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10 shadow-[0_0_32px_rgba(34,211,238,0.15)]">
            <Lock size={28} className="text-cyan-400" />
          </div>
          <div className="mb-1 text-base font-black text-white">
            LiTT is member-only
          </div>
          <div className="mb-6 text-xs leading-relaxed text-neutral-400">
            Sign in to chat with your AI crew and run commands.
          </div>
          <Link
            href="/sign-in?redirect_url=/litt"
            className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-black text-black shadow-[0_0_20px_rgba(34,211,238,0.25)] transition hover:opacity-90 hover:scale-[1.02]"
          >
            <Sparkles size={14} /> Sign in to LiTT
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

  return (
    <div className="h-full flex flex-col min-h-0">
      <LiTTTerminal />
    </div>
  );
}

export default function ChatPage() {
  return (
    <div className="h-full flex flex-col min-h-0 bg-[#030308]">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center bg-[#030308] p-6 text-neutral-400">
            <div className="flex flex-col items-center gap-4">
              <Loader2 size={24} className="animate-spin text-cyan-400" />
              <span className="text-xs font-black uppercase tracking-widest text-neutral-400">
                Loading LiTT
              </span>
            </div>
          </div>
        }
      >
        <ChatHub />
      </Suspense>
    </div>
  );
}
