"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import CommandStudio from "./components/CommandStudio";
import { Lock, Sparkles, Terminal, Loader2 } from "lucide-react";

/**
 * Studio initialization phases.
 *
 * These labels map to real signals:
 *  1. "Authenticating" — Clerk isLoaded becomes true
 *  2. "Loading workspace" — CommandStudio mounts and loads project context
 *  3. "Connecting runtime" — terminal-server connection established
 *  4. "Ready" — all signals green, Studio is interactive
 *
 * The loading UI only shows "Authenticating" while Clerk is loading —
 * the remaining phases are handled inside CommandStudio once it mounts.
 */
const INIT_STEPS = [
  "Authenticating",
  "Loading workspace",
  "Connecting runtime",
  "Ready",
] as const;

const INIT_TIMEOUT_MS = 8_000;

function StudioLoadingState({ onRetry }: { onRetry: () => void }) {
  const { tokens } = useTheme();
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), INIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  if (elapsed) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
        data-testid="studio-timeout"
      >
        <div className="relative flex flex-col items-center gap-4 text-center">
          <div
            className="text-sm font-bold"
            style={{ color: tokens.text }}
          >
            Studio couldn&rsquo;t finish connecting.
          </div>
          <button
            onClick={onRetry}
            className="rounded-xl border px-5 py-2.5 text-sm font-bold transition-all hover:opacity-80"
            style={{
              borderColor: `${tokens.primary}40`,
              color: tokens.primary,
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{ backgroundColor: tokens.background }}
      data-testid="studio-loading"
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px] opacity-20"
          style={{ backgroundColor: tokens.primary }}
        />
      </div>
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
            {INIT_STEPS[0]}
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

function StudioHub() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { tokens } = useTheme();
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = useCallback(() => {
    // Retry restarts the failed initialization by forcing a full
    // re-mount of the loading state + Clerk re-check, not merely
    // re-animating the spinner.
    setRetryKey((k) => k + 1);
  }, []);

  if (!isLoaded) {
    return <StudioLoadingState key={retryKey} onRetry={handleRetry} />;
  }

  if (!isSignedIn) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
        data-testid="studio-unauthenticated"
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full blur-[100px] opacity-10"
            style={{ backgroundColor: tokens.primary }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 h-48 w-48 rounded-full blur-[80px] opacity-8"
            style={{ backgroundColor: "#a855f7" }}
          />
        </div>
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
            href="/sign-in?redirect_url=/studio?tool=chat"
            className="mb-3 flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-black transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{
              backgroundColor: tokens.primary,
              boxShadow: `0 0 20px ${tokens.primary}40`,
            }}
          >
            <Sparkles size={14} /> Sign in to Studio
          </Link>
          <Link
            href="/sign-up"
            className="flex items-center justify-center gap-1 rounded-xl border px-5 py-2.5 text-xs font-bold transition-all hover:opacity-70"
            style={{ borderColor: tokens.border, color: tokens.textMuted }}
          >
            Create free account
          </Link>
        </div>
      </div>
    );
  }

  return <CommandStudio />;
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
