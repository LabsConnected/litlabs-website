"use client";

/**
 * Dashboard — LiTT's home launchpad (v3).
 *
 * Deliberately minimal. The hierarchy, in order:
 *   1. One universal "What do you want to make?" composer
 *   2. Creation type shortcuts
 *   3. Recent projects
 *   4. Only actionable warnings/status (ActionNeededStrip renders nothing
 *      unless something genuinely needs attention)
 *
 * Runtime telemetry — live project status, agent activity, recent media,
 * terminal/build/deploy state, branch/repository info — lives in Studio at
 * /studio/mission-control. The Developer drawer stays collapsed by default
 * and opens only through the explicit Developer button. No empty panels,
 * no disconnected states, no idle telemetry.
 *
 * Data comes from real authenticated APIs via useDashboardData hooks.
 * Media comes from the existing MediaHubProvider + MusicPlayerContext
 * via the useMediaDock coordination hook. No duplicate providers.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { X, Terminal, GitBranch, Rocket, ChevronRight, Search, Wrench } from "lucide-react";

import { AnimatedBackground } from "./AnimatedBackground";
import { BuildConsole } from "./BuildConsole";
import { ActionNeededStrip } from "./ActionNeededStrip";
import { RecentWork } from "./RecentWork";
import { MediaDock } from "./MediaDock";
import { CommandPalette } from "./CommandPalette";
import { useMediaDock } from "./useMediaDock";
import {
  useMissionControl,
  useDashboardMedia,
  deriveProject,
  derivePulseItems,
  deriveRecentProjects,
} from "./useDashboardData";
import type { DashboardProject } from "./types";

const LIME = "#a8ff2f";

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Data ────────────────────────────────────────────────────────
  const missionControl = useMissionControl();
  const dashboardMedia = useDashboardMedia();

  // ── Media dock (coordinates MediaHub + LiTT audio) ──────────────
  const { dock, actions: mediaActions } = useMediaDock();

  // ── Derived data ────────────────────────────────────────────────
  const currentProject = deriveProject(missionControl.data?.project ?? null);
  const pulseItems = derivePulseItems(missionControl.data ?? null);
  const recentProjects = deriveRecentProjects(missionControl.data ?? null);

  // ── UI state ────────────────────────────────────────────────────
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [focusModeOpen, setFocusModeOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [devDrawerOpen, setDevDrawerOpen] = useState(false);

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K → command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
      // Escape → close overlays
      if (e.key === "Escape") {
        setFocusModeOpen(false);
        setQueueOpen(false);
        setDevDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────
  const handleOpenTerminal = useCallback(() => {
    router.push("/studio?tool=terminal");
  }, [router]);

  const handleOpenFocusMode = useCallback(() => {
    setFocusModeOpen(true);
  }, []);

  const handleOpenQueue = useCallback(() => {
    setQueueOpen(true);
  }, []);

  const handleOpenDeveloperDrawer = useCallback(() => {
    setDevDrawerOpen(true);
  }, []);

  // ── Media dock visibility ───────────────────────────────────────
  // The dock renders only when there is something to play or a queue —
  // no persistent "nothing playing" bar (MediaDock returns null when empty).
  const showDock = true;

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{ background: "#0a0a0a" }}
      data-testid="dashboard-v3"
    >
      {/* Card entrance — subtle staggered rise on first paint only.
          Disabled entirely under prefers-reduced-motion. */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes dashboard-card-in {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .dashboard-card-in {
            animation: dashboard-card-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
            will-change: opacity, transform;
          }
        }
      `}</style>

      {/* Animated background */}
      <AnimatedBackground />

      {/* Main content — one calm centered column */}
      <main
        className="relative z-10 flex-1 overflow-y-auto px-4 pb-28 pt-5 md:px-6 md:pb-32 md:pt-7"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 md:gap-7">
          {/* Utility row — calm, right-aligned. The Developer drawer stays
              collapsed until this explicit button is tapped. */}
          <div className="flex items-center justify-between">
            <p
              className="text-[13px] font-medium tracking-wide"
              style={{ color: "#52525b" }}
              aria-hidden
            >
              Home
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition hover:text-white"
                style={{
                  borderColor: "rgba(255,255,255,.08)",
                  background: "rgba(18,18,21,.6)",
                  color: "#a1a1aa",
                }}
                aria-label="Search (Ctrl+K)"
              >
                <Search size={14} aria-hidden />
                <span className="hidden sm:inline">Search</span>
                <kbd
                  className="hidden rounded border px-1 py-px font-mono text-[10px] md:inline"
                  style={{ borderColor: "rgba(255,255,255,.1)", color: "#71717a" }}
                >
                  ⌘K
                </kbd>
              </button>
              <button
                type="button"
                onClick={handleOpenDeveloperDrawer}
                data-testid="developer-entry"
                className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition hover:text-white"
                style={{
                  borderColor: "rgba(255,255,255,.08)",
                  background: "rgba(18,18,21,.6)",
                  color: "#a1a1aa",
                }}
                aria-label="Open Developer and Diagnostics"
                title="Developer / Diagnostics"
              >
                <Wrench size={14} aria-hidden />
                <span className="hidden sm:inline">Developer</span>
              </button>
            </div>
          </div>

          {/* Actionable warnings only — renders nothing when all is well */}
          <div className="dashboard-card-in" style={{ animationDelay: "0ms" }}>
            <ActionNeededStrip items={pulseItems} loading={missionControl.loading} />
          </div>

          {/* 1 + 2: universal composer + creation type shortcuts */}
          <div className="dashboard-card-in" style={{ animationDelay: "60ms" }}>
            <BuildConsole initialPrompt={searchParams.get("prompt") ?? ""} />
          </div>

          {/* 3: recent projects */}
          <div className="dashboard-card-in" style={{ animationDelay: "120ms" }}>
            <RecentWork
              projects={recentProjects}
              loading={missionControl.loading}
              onOpenTerminal={handleOpenTerminal}
            />
          </div>
        </div>
      </main>

      {/* Media Dock (persistent footer) */}
      {showDock && (
        <MediaDock
          dock={dock}
          actions={mediaActions}
          onOpenQueue={handleOpenQueue}
          onOpenFocusMode={handleOpenFocusMode}
        />
      )}

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        projects={recentProjects}
        mediaItems={dashboardMedia.items}
        mediaActions={mediaActions}
        onOpenFocusMode={handleOpenFocusMode}
        onOpenQueue={handleOpenQueue}
        onOpenDeveloperDrawer={handleOpenDeveloperDrawer}
        onOpenTerminal={handleOpenTerminal}
      />

      {/* Queue Panel (slide-over) */}
      {queueOpen && (
        <QueuePanel
          dock={dock}
          actions={mediaActions}
          onClose={() => setQueueOpen(false)}
        />
      )}

      {/* Focus Mode overlay */}
      {focusModeOpen && (
        <FocusMode
          project={currentProject}
          dock={dock}
          actions={mediaActions}
          mediaItems={dashboardMedia.items}
          mediaActions={mediaActions}
          onClose={() => setFocusModeOpen(false)}
          onOpenQueue={handleOpenQueue}
        />
      )}

      {/* Developer Drawer (slide-over — collapsed until explicitly opened) */}
      {devDrawerOpen && (
        <DeveloperDrawer
          project={currentProject}
          loading={missionControl.loading}
          onClose={() => setDevDrawerOpen(false)}
          onOpenTerminal={handleOpenTerminal}
        />
      )}
    </div>
  );
}

// ── Queue Panel ───────────────────────────────────────────────────

function QueuePanel({
  dock,
  actions,
  onClose,
}: {
  dock: import("./useMediaDock").MediaDockValue;
  actions: import("./useMediaDock").MediaDockActions;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[150] flex justify-end"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
      data-testid="queue-panel"
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{
          background: "rgba(12,12,15,0.98)",
          borderColor: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <h3 className="text-sm font-bold" style={{ color: "#fafafa" }}>
            Queue ({dock.queue.length})
          </h3>
          <div className="flex items-center gap-2">
            {dock.queue.length > 0 && (
              <button
                onClick={actions.clearQueue}
                className="text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "#71717a" }}
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded p-1 transition-colors hover:bg-white/5"
              style={{ color: "#71717a" }}
              aria-label="Close queue"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Queue list */}
        <div className="flex-1 overflow-y-auto p-3">
          {dock.queue.length === 0 ? (
            <div
              className="flex h-full items-center justify-center text-sm"
              style={{ color: "#71717a" }}
            >
              Queue is empty. Play media or paste a URL to start.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {dock.queue.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className="flex items-center gap-3 rounded-md border p-3 transition-colors"
                  style={{
                    borderColor: item.isActive
                      ? "rgba(168,255,47,0.25)"
                      : "rgba(255,255,255,0.04)",
                    background: item.isActive
                      ? "rgba(168,255,47,0.06)"
                      : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!item.isActive)
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    if (!item.isActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Artwork */}
                  <div
                    className="h-10 w-10 shrink-0 overflow-hidden rounded"
                    style={{ background: "rgba(30,30,34,0.8)" }}
                  >
                    {item.artworkUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- remote artwork, mixed hosts
                      <img
                        src={item.artworkUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>

                  {/* Title + source */}
                  <button
                    onClick={() => actions.jumpTo(index)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                      style={{
                        background:
                          item.source === "youtube"
                            ? "rgba(255,0,0,0.15)"
                            : item.source === "spotify"
                              ? "rgba(30,215,96,0.15)"
                              : item.source === "litt"
                                ? "rgba(0,255,200,0.15)"
                                : "rgba(161,161,170,0.15)",
                        color:
                          item.source === "youtube"
                            ? "#ff6b6b"
                            : item.source === "spotify"
                              ? "#1ed760"
                              : item.source === "litt"
                                ? "#00ffc8"
                                : "#a1a1aa",
                      }}
                    >
                      {item.source === "litt" ? "LiTT" : item.source.toUpperCase()}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium"
                      style={{
                        color: item.isActive ? "#fafafa" : "#a1a1aa",
                      }}
                    >
                      {item.title}
                    </span>
                  </button>

                  {/* Remove */}
                  <button
                    onClick={() => actions.removeFromQueue(index)}
                    className="shrink-0 rounded p-1 transition-opacity hover:opacity-80"
                    style={{ color: "#71717a" }}
                    aria-label="Remove from queue"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* URL input at bottom */}
        <UrlInputFooter actions={actions} />
      </div>
    </div>
  );
}

function UrlInputFooter({
  actions,
}: {
  actions: import("./useMediaDock").MediaDockActions;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      setError(null);
      const ok = actions.loadUrl(input);
      if (!ok) {
        setError("Could not load this URL. Check the link and try again.");
        return;
      }
      setInput("");
    },
    [input, actions],
  );

  return (
    <div
      className="shrink-0 border-t p-3"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste YouTube, Spotify, or audio URL…"
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none transition"
          style={{
            backgroundColor: "rgba(18,18,21,0.8)",
            borderColor: "rgba(255,255,255,0.06)",
            color: "#fafafa",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "rgba(168,255,47,.5)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
          }}
          aria-label="Media URL input"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md px-4 py-2 text-sm font-bold transition hover:brightness-110"
          style={{
            backgroundColor: "rgba(168,255,47,0.14)",
            color: LIME,
            border: "1px solid rgba(168,255,47,0.3)",
          }}
        >
          Play
        </button>
      </form>
      {error && (
        <p className="mt-2 text-xs font-medium" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Focus Mode ────────────────────────────────────────────────────

function FocusMode({
  project,
  dock,
  actions,
  mediaItems,
  mediaActions,
  onClose,
  onOpenQueue,
}: {
  project: DashboardProject | null;
  dock: import("./useMediaDock").MediaDockValue;
  actions: import("./useMediaDock").MediaDockActions;
  mediaItems: import("./types").DashboardMediaItem[];
  mediaActions: import("./useMediaDock").MediaDockActions;
  onClose: () => void;
  onOpenQueue: () => void;
}) {
  const studioHref = project?.repository
    ? `/studio?project=${encodeURIComponent(project.id)}`
    : "/studio";

  const musicItems = mediaItems.filter((i) => i.type === "music" && i.track).slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-[180] flex flex-col"
      style={{ background: "rgba(5,5,8,0.96)", backdropFilter: "blur(20px)" }}
      data-testid="focus-mode"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          color: "#a1a1aa",
          background: "rgba(18,18,21,0.6)",
        }}
        aria-label="Exit Focus Mode"
      >
        <X size={16} />
        Exit Focus
      </button>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        {/* Current project */}
        {project ? (
          <div className="text-center">
            <p
              className="text-sm font-medium uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              Current Project
            </p>
            <h1
              className="mt-2 text-4xl font-bold tracking-tight md:text-5xl"
              style={{ color: "#fafafa" }}
            >
              {project.name}
            </h1>
            <div
              className="mt-3 flex items-center justify-center gap-4 font-mono text-sm"
              style={{ color: "#71717a" }}
            >
              {project.branch && <span>↳ {project.branch}</span>}
              <span>● {project.status}</span>
            </div>
            <a
              href={studioHref}
              className="mt-6 inline-flex items-center gap-2 rounded-md px-6 py-3 text-sm font-medium transition-colors"
              style={{
                background: LIME,
                color: "#0c1204",
                boxShadow: "0 0 20px rgba(168,255,47,0.3)",
              }}
            >
              Open Studio
              <ChevronRight size={16} />
            </a>
          </div>
        ) : (
          <div className="text-center">
            <h1
              className="text-4xl font-bold tracking-tight"
              style={{ color: "#fafafa" }}
            >
              LiTT
            </h1>
            <p className="mt-2 text-sm" style={{ color: "#71717a" }}>
              Ready to build.
            </p>
          </div>
        )}

        {/* Divider */}
        <div
          className="h-px w-full max-w-md"
          style={{ background: "rgba(255,255,255,0.06)" }}
        />

        {/* Now playing */}
        <div className="w-full max-w-md">
          <p
            className="mb-3 text-center text-sm font-medium uppercase tracking-widest"
            style={{ color: "#52525b" }}
          >
            Now Playing
          </p>
          {dock.source !== "none" ? (
            <div
              className="flex items-center gap-4 rounded-xl border p-4"
              style={{
                borderColor: "rgba(255,255,255,0.06)",
                background: "rgba(18,18,21,0.6)",
              }}
            >
              {/* Artwork */}
              <div
                className="h-16 w-16 shrink-0 overflow-hidden rounded-lg"
                style={{ background: "rgba(30,30,34,0.8)" }}
              >
                {dock.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote artwork, mixed hosts
                    <img
                    src={dock.artworkUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center"
                    style={{ color: LIME }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                )}
              </div>
              {/* Info */}
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-bold"
                  style={{ color: "#fafafa" }}
                >
                  {dock.title}
                </p>
                <p
                  className="truncate text-xs font-mono"
                  style={{ color: "#71717a" }}
                >
                  {dock.creator}
                </p>
                {/* Mini controls */}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={actions.previous}
                    className="transition-colors hover:text-white"
                    style={{ color: "#a1a1aa" }}
                    aria-label="Previous"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                    </svg>
                  </button>
                  <button
                    onClick={actions.toggle}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105"
                    style={{ background: "#fafafa", color: "#0a0a0a" }}
                    aria-label={dock.isPlaying ? "Pause" : "Play"}
                  >
                    {dock.isPlaying ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={actions.next}
                    className="transition-colors hover:text-white"
                    style={{ color: "#a1a1aa" }}
                    aria-label="Next"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z" />
                    </svg>
                  </button>
                  <button
                    onClick={onOpenQueue}
                    className="ml-2 text-xs font-medium transition-colors hover:text-white"
                    style={{ color: "#52525b" }}
                  >
                    Queue ({dock.queue.length})
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="rounded-xl border p-6 text-center"
              style={{
                borderColor: "rgba(255,255,255,0.06)",
                background: "rgba(18,18,21,0.4)",
              }}
            >
              <p className="text-sm" style={{ color: "#52525b" }}>
                Nothing playing. Select a track below.
              </p>
            </div>
          )}
        </div>

        {/* Quick music picks */}
        {musicItems.length > 0 && dock.source === "none" && (
          <div className="w-full max-w-md">
            <p
              className="mb-2 text-center text-xs font-medium uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              Quick Play
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {musicItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => mediaActions.playLittTrack(item.track!)}
                  className="rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
                  style={{
                    borderColor: "rgba(255,255,255,0.06)",
                    background: "rgba(18,18,21,0.6)",
                    color: "#a1a1aa",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(168,255,47,0.35)";
                    e.currentTarget.style.color = "#fafafa";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  ▷ {item.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Developer Drawer (collapsed until explicitly opened) ──────────

function DeveloperDrawer({
  project,
  loading,
  onClose,
  onOpenTerminal,
}: {
  project: DashboardProject | null;
  loading: boolean;
  onClose: () => void;
  onOpenTerminal: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[150] flex justify-end"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
      data-testid="developer-drawer"
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{
          background: "rgba(12,12,15,0.98)",
          borderColor: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <div>
            <h3 className="text-sm font-bold" style={{ color: "#fafafa" }}>
              Developer
            </h3>
            <p className="mt-0.5 text-[11px]" style={{ color: "#52525b" }}>
              Diagnostics &amp; runtime info
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded p-1 transition-colors hover:bg-white/5"
            style={{ color: "#71717a" }}
            aria-label="Close developer drawer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                />
              ))}
            </div>
          ) : !project ? (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: "#71717a" }}>
                No project connected. Open a project in Studio to see
                runtime information here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Project info */}
              <DevInfoCard label="Project" value={project.name} />
              <DevInfoCard
                label="Branch"
                value={project.branch || "—"}
                icon={<GitBranch size={14} />}
              />
              <DevInfoCard
                label="Repository"
                value={project.repository || "—"}
              />
              <DevInfoCard
                label="Latest Commit"
                value={project.latestCommit?.slice(0, 7) ?? "—"}
                mono
              />
              <DevInfoCard
                label="Deployment"
                value={project.deploymentState}
                icon={<Rocket size={14} />}
              />
              <DevInfoCard
                label="Preview"
                value={project.previewState}
              />
              <DevInfoCard
                label="Workspace"
                value={project.workspaceState}
              />
              <DevInfoCard
                label="Terminal"
                value={project.terminalState}
                icon={<Terminal size={14} />}
              />

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={onOpenTerminal}
                  className="flex w-full items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors"
                  style={{
                    borderColor: "rgba(168,255,47,0.25)",
                    background: "rgba(168,255,47,0.07)",
                    color: LIME,
                  }}
                >
                  <Terminal size={16} />
                  Open Terminal
                </button>
                <Link
                  href="/studio/mission-control"
                  className="flex w-full items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
                  style={{
                    borderColor: "rgba(255,255,255,0.08)",
                    color: "#a1a1aa",
                  }}
                >
                  Mission control — status, activity &amp; media
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DevInfoCard({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-lg border px-3 py-2.5"
      style={{
        borderColor: "rgba(255,255,255,0.04)",
        background: "rgba(18,18,21,0.4)",
      }}
    >
      <span
        className="flex items-center gap-2 text-xs font-medium"
        style={{ color: "#71717a" }}
      >
        {icon}
        {label}
      </span>
      <span
        className={`text-xs font-bold ${mono ? "font-mono" : ""}`}
        style={{ color: "#fafafa" }}
      >
        {value}
      </span>
    </div>
  );
}
