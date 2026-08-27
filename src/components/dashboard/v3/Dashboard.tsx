"use client";

/**
 * Dashboard — LiTT's home / control center (v3).
 *
 * Composition:
 *   - AnimatedBackground (subtle WebGL shader)
 *   - DashboardHeader (brand, nav, search → command palette, BITS, profile)
 *   - ProjectPulseBar (real deployment/build/test/branch/terminal status)
 *   - Main content grid:
 *       Left:  ContinueWorking (hero) + QuickStart
 *       Right: RecentWork + RecentMedia
 *   - MediaDock (persistent footer — collapsed/expanded, real MediaHub + LiTT audio)
 *   - CommandPalette (Ctrl+K — real destinations/actions)
 *   - FocusMode (overlay — reduces noise, emphasizes project + media + next action)
 *   - DeveloperDrawer (real project/runtime info — no fake green checks)
 *
 * Data comes from real authenticated APIs via useDashboardData hooks.
 * Media comes from the existing MediaHubProvider + MusicPlayerContext
 * via the useMediaDock coordination hook. No duplicate providers.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Terminal, GitBranch, Rocket, ChevronRight } from "lucide-react";

import { AnimatedBackground } from "./AnimatedBackground";
import { DashboardHeader } from "./DashboardHeader";
import { ProjectPulseBar } from "./ProjectPulseBar";
import { ContinueWorking } from "./ContinueWorking";
import { QuickStart } from "./QuickStart";
import { RecentWork } from "./RecentWork";
import { RecentMedia } from "./RecentMedia";
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
import type { PulseItem, DashboardProject } from "./types";

export function Dashboard() {
  const router = useRouter();

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

  const handlePulseItemClick = useCallback(
    (item: PulseItem) => {
      // Terminal items open terminal, deployment items open dev drawer
      if (item.id === "terminal") {
        handleOpenTerminal();
      } else {
        setDevDrawerOpen(true);
      }
    },
    [handleOpenTerminal],
  );

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
  // The dock is always visible at the bottom (even when nothing is
  // playing — it shows an empty state with "Open Queue" CTA).
  const showDock = true;

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{ background: "#0a0a0a" }}
      data-testid="dashboard-v3"
    >
      {/* Animated background */}
      <AnimatedBackground />

      {/* Header */}
      <DashboardHeader onOpenCommandPalette={() => setCommandPaletteOpen(true)} />

      {/* Project pulse bar */}
      <ProjectPulseBar
        items={pulseItems}
        loading={missionControl.loading}
        onItemClick={handlePulseItemClick}
      />

      {/* Main content */}
      <main
        className="relative z-10 flex-1 overflow-y-auto px-4 pb-28 pt-6 md:px-6 md:pb-32"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left column: Hero + Quick Start */}
          <div className="flex flex-col gap-6 lg:col-span-7">
            <ContinueWorking
              project={currentProject}
              loading={missionControl.loading}
              onOpenTerminal={handleOpenTerminal}
              onOpenDeveloperDrawer={handleOpenDeveloperDrawer}
            />
            <QuickStart />
          </div>

          {/* Right column: Recent Work + Recent Media */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            <RecentWork
              projects={recentProjects}
              loading={missionControl.loading}
              onOpenTerminal={handleOpenTerminal}
            />
            <RecentMedia
              items={dashboardMedia.items}
              loading={dashboardMedia.loading}
              error={dashboardMedia.error}
              mediaActions={mediaActions}
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

      {/* Developer Drawer (slide-over) */}
      {devDrawerOpen && (
        <DeveloperDrawer
          project={currentProject}
          pulseItems={pulseItems}
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
                      ? "rgba(167,139,250,0.2)"
                      : "rgba(255,255,255,0.04)",
                    background: item.isActive
                      ? "rgba(167,139,250,0.06)"
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
                      // eslint-disable-next-line @next/next/no-img-element
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
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none transition focus:border-[#a78bfa]"
          style={{
            backgroundColor: "rgba(18,18,21,0.8)",
            borderColor: "rgba(255,255,255,0.06)",
            color: "#fafafa",
          }}
          aria-label="Media URL input"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md px-4 py-2 text-sm font-bold transition hover:opacity-80"
          style={{
            backgroundColor: "rgba(167,139,250,0.15)",
            color: "#a78bfa",
            border: "1px solid rgba(167,139,250,0.25)",
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
                background: "#a78bfa",
                color: "#0a0012",
                boxShadow: "0 0 20px rgba(167,139,250,0.3)",
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={dock.artworkUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center"
                    style={{ color: "#a78bfa" }}
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
                    e.currentTarget.style.borderColor = "rgba(167,139,250,0.3)";
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

// ── Developer Drawer ──────────────────────────────────────────────

function DeveloperDrawer({
  project,
  pulseItems,
  loading,
  onClose,
  onOpenTerminal,
}: {
  project: DashboardProject | null;
  pulseItems: PulseItem[];
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
          <h3 className="text-sm font-bold" style={{ color: "#fafafa" }}>
            Developer
          </h3>
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

              {/* Status pulse items */}
              <div className="pt-2">
                <p
                  className="mb-2 text-xs font-bold uppercase tracking-widest"
                  style={{ color: "#52525b" }}
                >
                  Status
                </p>
                <div className="space-y-1.5">
                  {pulseItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                      style={{
                        borderColor: "rgba(255,255,255,0.04)",
                        background: "rgba(18,18,21,0.4)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: getPulseColor(item.state),
                            opacity: item.state === "unknown" ? 0.5 : 1,
                          }}
                        />
                        <span
                          className="text-xs font-medium"
                          style={{ color: "#a1a1aa" }}
                        >
                          {item.label}
                        </span>
                      </div>
                      {item.detail && (
                        <span
                          className="truncate text-[10px] font-mono"
                          style={{ color: "#52525b" }}
                          title={item.detail}
                        >
                          {item.detail}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2">
                <button
                  onClick={onOpenTerminal}
                  className="flex w-full items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors"
                  style={{
                    borderColor: "rgba(167,139,250,0.2)",
                    background: "rgba(167,139,250,0.06)",
                    color: "#a78bfa",
                  }}
                >
                  <Terminal size={16} />
                  Open Terminal
                </button>
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

function getPulseColor(state: PulseItem["state"]): string {
  switch (state) {
    case "live":
    case "passing":
      return "#34d399";
    case "building":
      return "#f59e0b";
    case "failed":
      return "#ef4444";
    case "idle":
      return "#a1a1aa";
    default:
      return "#71717a";
  }
}
