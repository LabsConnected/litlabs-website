"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import { track } from "@/lib/analytics";
import CommandStudio from "./components/CommandStudio";
import StudioShell from "@/components/page-shells/StudioShell";
import { useStudioLayoutMode } from "./stores/useStudioLayoutMode";

/**
 * Studio initialization phases.
 *
 * These map to real signals:
 *  1. Clerk isLoaded becomes true
 *  2. CommandStudio mounts and loads project context
 *  3. terminal-server connection established
 *  4. all signals green, Studio is interactive
 *
 * While they resolve, the visible first paint is the chosen layout's
 * shell skeleton (StudioShell) — phases 2–4 are handled inside
 * CommandStudio once it mounts. INIT_TIMEOUT_MS bounds the wait:
 * past it, the loading state becomes the failure/retry state only.
 */
const INIT_TIMEOUT_MS = 8_000;

function StudioLoadingState({ onRetry }: { onRetry: () => void }) {
  const { tokens } = useTheme();
  // The chosen layout's shell is the first paint (Studio entry fix,
  // Larry 2026-11-18): board by default, Regular when that is the
  // persisted choice — never a centered spinner / welcome screen.
  const { layoutMode } = useStudioLayoutMode();
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

  // Normal first paint: the chosen layout's shell skeleton, in
  // place — header + panel-shaped placeholders with the chat
  // placeholder in its real panel position. The centered
  // "Authenticating" spinner this replaced was the loading-type
  // screen Larry ruled out (2026-11-18); the timeout branch above
  // remains ONLY as a failure state after INIT_TIMEOUT_MS.
  return (
    <div
      className="relative min-h-full overflow-hidden"
      style={{ backgroundColor: tokens.background }}
      data-testid="studio-loading"
    >
      <StudioShell layout={layoutMode === "classic" ? "classic" : "board"} />
    </div>
  );
}

function StudioHub() {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [retryKey, setRetryKey] = useState(0);
  // Clerk's injected session state can make isLoaded resolve true before
  // hydration while SSR always renders the loading branch — gate the first
  // client render on mounted so server and client markup match (React #418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleRetry = useCallback(() => {
    // Retry restarts the failed initialization by forcing a full
    // re-mount of the loading state + Clerk re-check, not merely
    // re-animating the spinner.
    setRetryKey((k) => k + 1);
  }, []);

  // ── Website start (Larry's directive, 2026-11-10) ──────────────────
  // The landing's Website chip links to /studio?creator=website. A
  // fresh Website build must go straight down the working path —
  // describe → generate → static preview/publish on a NEW blank
  // managed project — and must NOT land in whatever project happens
  // to be selected (for many users the repo-backed project, whose
  // live workspace is HOST_EXECUTION_DISABLED on the hosted service
  // and dead-ends the flow at the sandbox wall). "Open GitHub repo"
  // stays a separate, explicit choice inside Studio; it never gates
  // a website build. So: creator=website with no ?project= creates
  // the blank project up front (a POST /api/studio-projects blank
  // create) and pins it in the URL. An explicit ?project= always wins.
  // The POST opts in to empty-project reuse, so a repeat entry pins
  // the previous entry's still-untouched blank instead of minting
  // another duplicate (#892 intent preserved: never the selected
  // repo project, never a project the user has actually worked in).
  const websiteIntent =
    searchParams.get("creator") === "website" && !searchParams.get("project");
  const websiteStartRef = useRef(false);
  const [websiteState, setWebsiteState] = useState<{
    status: "idle" | "creating" | "error";
    error?: string;
  }>({ status: "idle" });

  const startWebsiteBuild = useCallback(async () => {
    setWebsiteState({ status: "creating" });
    try {
      const token = await getToken?.();
      const res = await fetch("/api/studio-projects", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sourceType: "blank",
          name: "New Website",
          templateId: "blank-static",
          // Repeat entries focus the still-untouched blank from the
          // last entry instead of piling up identical empty projects;
          // the server only reuses a provably untouched one.
          reuseUntouchedBlank: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Failed (${res.status})`);
      }
      const { project } = await res.json();
      if (!project?.id) throw new Error("No project ID returned");
      router.replace(`/studio?project=${encodeURIComponent(project.id)}&tool=chat`);
    } catch (err) {
      setWebsiteState({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to create project",
      });
    }
  }, [getToken, router]);

  useEffect(() => {
    if (!mounted || !isLoaded || !isSignedIn) return;
    if (!websiteIntent) return;
    if (websiteStartRef.current) return;
    websiteStartRef.current = true;
    void startWebsiteBuild();
  }, [mounted, isLoaded, isSignedIn, websiteIntent, startWebsiteBuild]);

  const retryWebsiteStart = useCallback(() => {
    websiteStartRef.current = true;
    void startWebsiteBuild();
  }, [startWebsiteBuild]);

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

  // Website start (see startWebsiteBuild above): while the blank
  // project is being created show the loading state; on failure show
  // an honest error with retry — never fall through into whatever
  // project was previously selected.
  if (websiteIntent) {
    if (websiteState.status === "error") {
      return (
        <div
          className="flex min-h-full items-center justify-center p-6"
          data-testid="website-start-error"
        >
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="text-sm font-bold" style={{ color: "var(--text-main, #0e1510)" }}>
              Couldn&rsquo;t start your website project.
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted, #5c6b5e)" }}>
              {websiteState.error}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={retryWebsiteStart}
                className="rounded-xl border px-5 py-2.5 text-sm font-bold transition-all hover:opacity-80"
              >
                Retry
              </button>
              <a href="/studio" className="rounded-xl border px-5 py-2.5 text-sm font-bold transition-all hover:opacity-80">
                Studio home
              </a>
            </div>
          </div>
        </div>
      );
    }
    return <StudioLoadingState key={retryKey} onRetry={handleRetry} />;
  }

  // One-chat entry (Larry's directive, 2026-11-11; ART-20261111-031),
  // superseding the Studio prime landing (ART-20261110-029): the
  // "What do you want to make?" hub page is RETIRED. A bare /studio
  // visit falls through to the CommandStudio workspace below — the
  // one chat — exactly like every deep link (?project=, ?tool=,
  // ?creator=, ?prompt=…) and like a pending first-run handoff. The
  // creation-type chips survive only as entry hints inside that chat
  // (LiTEmptyState, resolved by resolveEntryCreateType), and a
  // describe typed at entry lands in the chat's own composer via
  // ?prompt= (takeFirstRunPrompt) — typed once, never re-asked.
  //
  // The first-run welcome screen is RETIRED too (Larry's direct
  // order, 2026-11-25): there is no project-count gate here at all.
  // EVERY signed-in user — including a zero-project account — opens
  // straight into the real Studio. A first chat send from a
  // zero-project account is provisioned server-side (the
  // conversations POST binds a starter project), and CommandStudio
  // consumes ?prompt= itself, so the dashboard "Ask LiTT" handoff
  // lands in the chat composer for fresh users exactly as it does
  // for existing users.
  return <CommandStudio />;
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        // The route's very first paint is already the layout's shell
        // (board-shaped: the default layout — the persisted choice
        // is client state and resolves a beat later in StudioHub,
        // which renders the matching skeleton for Regular users).
        <StudioShell layout="board" />
      }
    >
      <StudioHub />
    </Suspense>
  );
}
