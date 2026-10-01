"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { track } from "@/lib/analytics";
import CommandStudio from "./components/CommandStudio";
import FirstRunWelcome from "./components/FirstRunWelcome";
import { Terminal, Loader2 } from "lucide-react";

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
        className="relative flex min-h-full items-center justify-center overflow-hidden p-6"
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
            type="button"
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
      className="relative flex min-h-full items-center justify-center overflow-hidden p-6"
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
  const router = useRouter();
  const [retryKey, setRetryKey] = useState(0);
  // Clerk's injected session state can make isLoaded resolve true before
  // hydration while SSR always renders the loading branch — gate the first
  // client render on mounted so server and client markup match (React #418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // First-run: check if user has any projects
  const [projectCheck, setProjectCheck] = useState<{
    loading: boolean;
    hasProjects: boolean | null;
  }>({ loading: true, hasProjects: null });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleRetry = useCallback(() => {
    // Retry restarts the failed initialization by forcing a full
    // re-mount of the loading state + Clerk re-check, not merely
    // re-animating the spinner.
    setRetryKey((k) => k + 1);
  }, []);

  // Check for fresh user (no projects) — show welcome flow
  useEffect(() => {
    if (!mounted || !isLoaded || !isSignedIn) return;

    // Skip check if project already in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get("project")) {
      setProjectCheck({ loading: false, hasProjects: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/studio-projects", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const projects = data.projects || data || [];
        const hasProjects = Array.isArray(projects) ? projects.length > 0 : false;
        if (!cancelled) setProjectCheck({ loading: false, hasProjects });
      } catch {
        // On error, assume has projects to avoid blocking existing users
        if (!cancelled) setProjectCheck({ loading: false, hasProjects: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, isLoaded, isSignedIn, retryKey]);

  const handleFirstRunSubmit = useCallback(
    async (idea: string) => {
      setIsCreating(true);
      setCreateError(null);
      try {
        const res = await fetch("/api/studio-projects", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: "blank",
            name: idea.slice(0, 60) || "Untitled Project",
            templateId: "blank-static",
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `Failed (${res.status})`);
        }
        const { project } = await res.json();
        if (!project?.id) throw new Error("No project ID returned");

        const params = new URLSearchParams(window.location.search);
        params.set("project", project.id);
        params.set("prompt", idea);
        params.set("tool", "chat");
        // Store prompt in sessionStorage as reliable handoff (URL params can be lost on rapid navigation)
        try {
          sessionStorage.setItem("litt:first-run-prompt", idea);
        } catch {}
        router.replace(`/studio?${params.toString()}`);
        setProjectCheck({ loading: false, hasProjects: true });
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Failed to create project");
      } finally {
        setIsCreating(false);
      }
    },
    [router]
  );

  const handleFirstRunRetry = useCallback(() => {
    setCreateError(null);
    setProjectCheck({ loading: true, hasProjects: null });
    setRetryKey((k) => k + 1);
  }, []);

  // The proxy (src/proxy.ts, Next.js 16's renamed middleware) redirects
  // signed-out users to /sign-in at the server level before this page renders.
  // This client-side guard handles session expiry while the page is open
  // (the server redirect only fires on initial navigation, not mid-session).
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/sign-in?redirect_url=%2Fstudio");
    }
    if (isLoaded && isSignedIn) {
      track("studio_opened");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!mounted || !isLoaded) {
    return <StudioLoadingState key={retryKey} onRetry={handleRetry} />;
  }

  if (!isSignedIn) {
    // Brief loading state while the redirect fires — never a custom
    // "member-only" screen (middleware is the source of truth).
    return <StudioLoadingState key={retryKey} onRetry={handleRetry} />;
  }

  // Fresh user with no projects → first-run welcome
  if (projectCheck.loading) {
    return <StudioLoadingState key={retryKey} onRetry={handleRetry} />;
  }

  if (projectCheck.hasProjects === false) {
    return (
      <FirstRunWelcome
        onSubmit={handleFirstRunSubmit}
        isCreating={isCreating}
        error={createError}
        onRetry={handleFirstRunRetry}
      />
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
          className="flex min-h-full items-center justify-center p-6"
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
