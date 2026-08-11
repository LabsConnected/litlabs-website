"use client";

/**
 * MissionControlDashboard — LiTT Mission Control (Premium Redesign)
 *
 * Dark futuristic command center with:
 *   - Ambient background (violet/cyan radials, grid, grain)
 *   - LiTT command center with animated border beam
 *   - Visual project cards with screenshots/fallbacks
 *   - Compact system status with pulse indicators
 *   - Quick launch tiles
 *   - Recent activity timeline
 *   - Compact usage/bits module
 *   - Framer Motion entrance animations
 *   - Cursor spotlight on major panels
 *   - prefers-reduced-motion support
 *
 * Fetches from /api/dashboard/mission-control (aggregated server-side).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppUser } from "@/hooks/useClerkAuth";
import { MediaNowPlayingCard } from "@/components/media/MediaNowPlayingCard";
import { Icon, getGreeting, timeAgo } from "./dashboard-v2-utils";
import type { MissionControlResponse } from "@/lib/mission-control";
import { DraggableWidgetGrid } from "@/components/dashboard/v2/DraggableWidgetGrid";
import { D as DashTokens } from "@/lib/dashboard/tokens";
import { useDashboardTheme } from "@/lib/dashboard/theme-store";
import type { RecentCreation } from "@/lib/dashboard/recent-creations";
import type { GalleryWidgetData } from "@/lib/dashboard/gallery-widget-data";
import type { DiscoverFeedItem } from "@/lib/dashboard/discover-widget-data";
import {
  DashboardAmbientBackground,
  CursorSpotlight,
  BorderBeam,
  StatusPulse,
  EntranceSection,
  GlassPanel,
} from "./DashboardEffects";

const D = { ...DashTokens, bg: "transparent", bgGradient: DashTokens.heroGradient };

const STATE_COLOR: Record<string, string> = {
  healthy: D.accentGreen, connected: D.accentGreen, authorized: D.accentAmber,
  linked: D.accentAmber, live: D.accentGreen, operational: D.accentGreen,
  configured: D.accentAmber, checking: D.accentCyan, degraded: D.accentAmber,
  rate_limited: D.accentAmber, reconnect_required: D.accentAmber,
  unauthorized: D.accentRed, unavailable: D.accentRed, failed: D.accentRed,
  disconnected: D.textDim, not_connected: D.textDim, not_configured: D.textDim,
  missing: D.textDim,
};

const MISSION_STATE_COLOR: Record<string, string> = {
  created: D.textMuted, inspecting: D.accentCyan, planning: D.accent,
  awaiting_approval: D.accentAmber, executing: D.accentGreen,
  verifying: D.accentCyan, completed: D.accentGreen, failed: D.accentRed,
  paused: D.accentAmber, cancelled: D.textDim,
};

function stateLabel(state: string): string {
  return state.replaceAll("_", " ");
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function MissionCard({ mission }: { mission: MissionControlResponse["missions"][number] }) {
  const color = MISSION_STATE_COLOR[mission.state] || D.textMuted;
  return (
    <Link
      href={`/studio?mission=${encodeURIComponent(mission.id)}`}
      className="group block rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.005]"
      style={{ background: "rgba(10,9,18,0.60)", borderColor: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[.16em] capitalize" style={{ color }}>
              {stateLabel(mission.state)}
            </span>
            <span className="text-[10px]" style={{ color: D.textDim }}>
              {mission.agent === "spark" ? "Spark" : "LiTT"}
            </span>
          </div>
          <h3 className="mt-2 truncate text-sm font-black" style={{ color: D.textPrimary }}>{mission.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: D.textMuted }}>
            {mission.blockedReason || mission.currentStep || "Mission ready to continue."}
          </p>
        </div>
        <Icon name="arrow" size={15} className="mt-1 shrink-0 transition group-hover:translate-x-0.5" style={{ color: D.textDim }} />
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[10px]" style={{ color: D.textDim }}>
          <span>Progress</span>
          <span>{Math.max(0, Math.min(100, mission.progress))}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: D.skeleton }}>
          <div className="h-full rounded-full" style={{
            width: `${Math.max(0, Math.min(100, mission.progress))}%`,
            background: `linear-gradient(to right, ${D.accent}, ${D.accentGreen})`,
          }} />
        </div>
      </div>
    </Link>
  );
}

/* ─── Quick Launch Tile ──────────────────────────────────────────────── */

function QuickLaunchTile({
  icon,
  label,
  description,
  href,
  accentColor,
}: {
  icon: string;
  label: string;
  description: string;
  href: string;
  accentColor: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        background: `${accentColor}08`,
        borderColor: `${accentColor}25`,
        minHeight: 110,
        boxShadow: `0 4px 20px ${accentColor}10`,
      }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
        style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}
      >
        <Icon name={icon} size={20} style={{ color: accentColor }} />
      </div>
      <div className="text-sm font-black" style={{ color: D.textPrimary }}>{label}</div>
      <div className="text-[10px]" style={{ color: D.textMuted }}>{description}</div>
    </Link>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────── */

export function MissionControlDashboard() {
  const router = useRouter();
  const [data, setData] = useState<MissionControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAppUser();
  const displayName = user?.firstName || user?.username || "there";

  // LiTT command center state
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<string>("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);

  const [widgetData, setWidgetData] = useState<{
    recentCreations?: RecentCreation[];
    gallery?: GalleryWidgetData;
    discoverFeed?: DiscoverFeedItem[];
  }>({});
  const ownerMode = data?.ownerMode ?? false;

  const MODE_CONFIG: Record<string, { label: string; tool?: string; placeholder: string }> = {
    chat: { label: "Ask LiTT", placeholder: "Describe your idea, problem, or next task..." },
    builder: { label: "Build", tool: "build", placeholder: "Describe the app or site you want to build..." },
    image: { label: "Create", tool: "image", placeholder: "Describe the image you want to create..." },
    music: { label: "Music", tool: "music", placeholder: "Describe the music you want to create..." },
    agent: { label: "Automate", tool: "agents", placeholder: "Describe the mission for your agent..." },
    research: { label: "Research", tool: "chat", placeholder: "What do you want to research?" },
    browser: { label: "Browser", tool: "browser", placeholder: "What do you want the browser agent to do?" },
    voice: { label: "Voice", tool: "chat", placeholder: "Start a voice conversation with LiTT..." },
  };

  function studioHref(mode: string, prompt: string) {
    const params = new URLSearchParams();
    const config = MODE_CONFIG[mode];
    if (config?.tool) params.set("tool", config.tool);
    if (prompt.trim()) params.set("mission", prompt.trim());
    return `/studio${params.size ? `?${params.toString()}` : ""}`;
  }

  const submit = () => router.push(studioHref(mode, prompt));

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Upload failed");
      router.push(studioHref("chat", `Help me work with ${file.name}. File: ${result.url}`));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const startVoice = () => {
    type SpeechResult = { 0: { transcript: string } };
    type SpeechEvent = { results: ArrayLike<SpeechResult> };
    type SpeechRecognitionLike = { lang: string; interimResults: boolean; start: () => void; onresult: (event: SpeechEvent) => void; onend: () => void; onerror: () => void };
    type SpeechCtor = new () => SpeechRecognitionLike;
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) { router.push(studioHref("chat", "Start a voice conversation with LiTT")); return; }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => setPrompt(event.results[event.results.length - 1][0].transcript);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const loadWidgetData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/widgets?widgets=recent-creations,my-gallery,trending-gallery,discover-feed", {
        cache: "no-store", credentials: "include",
      });
      if (res.ok) setWidgetData(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadWidgetData(); }, [loadWidgetData]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/mission-control", { cache: "no-store", credentials: "include" });
      if (!response.ok) {
        setError(response.status === 401 ? "Your sign-in session needs to be refreshed." : "Mission Control is temporarily unavailable.");
        return;
      }
      setData(await response.json());
    } catch {
      setError("Mission Control is temporarily unavailable.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeMissions = useMemo(
    () => (data?.missions ?? []).filter((m) => !["completed", "failed", "cancelled"].includes(m.state)),
    [data],
  );

  const urgentCount = useMemo(
    () => (data?.health ?? []).filter((s) => ["failed", "degraded", "disconnected", "reconnect_required"].includes(s.state)).length +
      (data?.missions ?? []).filter((m) => m.state === "failed" || m.state === "awaiting_approval").length,
    [data],
  );

  /* ─── Loading state ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: D.bgGradient, color: D.textPrimary }}>
        <DashboardAmbientBackground />
        <div className="relative z-10 mx-auto w-full max-w-[1680px] px-4 py-5 lg:px-6 xl:px-8">
          <div className="mb-5 rounded-3xl border p-5" style={{ borderColor: D.border, background: D.surface, backdropFilter: "blur(20px)" }}>
            <div className="h-5 w-40 animate-pulse rounded-full" style={{ background: D.skeleton }} />
            <div className="mt-3 h-8 w-64 animate-pulse rounded-lg" style={{ background: D.skeleton }} />
          </div>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-3xl border" style={{ borderColor: D.border, background: D.surface }} />
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
            <div className="h-64 animate-pulse rounded-3xl border" style={{ borderColor: D.border, background: D.surface }} />
            <div className="h-48 animate-pulse rounded-3xl border" style={{ borderColor: D.border, background: D.surface }} />
          </div>
        </div>
      </main>
    );
  }

  /* ─── System status summary ──────────────────────────────────────── */
  const systemStatuses = [
    { label: "GitHub", state: data?.project ? "connected" : "not_connected", detail: data?.project?.repository ?? "Not connected" },
    { label: "Runtime", state: data?.project?.terminalState ?? "disconnected", detail: data?.project?.terminalState === "connected" ? "Online" : "Offline" },
    { label: "Workspace", state: data?.project?.workspaceState ?? "missing", detail: data?.project?.workspaceState === "ready" ? "Ready" : "Setup needed" },
    { label: "Production", state: data?.project?.deploymentState ?? "none", detail: data?.project?.deploymentState === "production" ? "Live" : "Not deployed" },
  ];

  const balance = data?.billing.balance ?? 0;
  const plan = data?.billing.plan ?? "Free";

  return (
    <main className="min-h-screen" style={{ background: D.bgGradient, color: D.textPrimary }}>
      <DashboardAmbientBackground />
      <div className="relative z-10 mx-auto w-full max-w-[1680px] px-4 py-5 lg:px-6 xl:px-8">
        {/* === Header === */}
        <EntranceSection delay={0}>
          <header className="mb-5 flex flex-col gap-4 rounded-3xl border p-5 md:flex-row md:items-center md:justify-between"
            style={{ background: "rgba(10,9,18,0.70)", borderColor: "rgba(139,92,246,0.20)", backdropFilter: "blur(18px)", boxShadow: "0 8px 32px rgba(0,0,0,0.24)" }}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusPulse color={D.accentGreen} label="LiTT Online" pulse />
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-[-.04em] sm:text-3xl" style={{ color: D.textPrimary }}>
                {getGreeting()}, {displayName}.
              </h1>
              <p className="mt-1 text-sm" style={{ color: D.textMuted }}>Your creative command center</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/wallet" className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition hover:scale-[1.02]"
                style={{ borderColor: D.border, background: D.surface, color: D.textMuted }}>
                <Icon name="wallet" size={14} />
                {balance.toLocaleString()} BITS · {plan}
              </Link>
              <button type="button" onClick={() => void load()} disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition hover:opacity-80 disabled:opacity-50"
                style={{ borderColor: D.border, background: D.surface, color: D.textMuted }}>
                <Icon name="refresh" size={14} className={refreshing ? "animate-spin" : ""} />
              </button>
              <ThemeToggle />
            </div>
          </header>
        </EntranceSection>

        {/* === Error banner === */}
        {error && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
            style={{ borderColor: `${D.accentRed}33`, background: `${D.accentRed}10`, color: D.dangerText }}>
            <Icon name="alert" size={17} />
            {error}
            <button type="button" onClick={() => void load()} className="ml-auto rounded-lg px-2 py-1 text-[10px] font-bold transition hover:opacity-80" style={{ background: `${D.accentRed}20` }}>Retry</button>
          </div>
        )}

        {/* === LiTT Command Center === */}
        <EntranceSection delay={0.08}>
          <CursorSpotlight className="mb-5">
            <BorderBeam className="rounded-3xl">
              <div className="rounded-3xl border border-white/8 p-5 sm:p-7" style={{ background: "rgba(10,9,18,0.75)", backdropFilter: "blur(18px)" }}>
                <div className="flex items-center gap-2">
                  <Icon name="sparkles" size={16} style={{ color: D.accent }} />
                  <span className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: D.accent }}>What are we building?</span>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                    placeholder={MODE_CONFIG[mode]?.placeholder ?? "Describe anything you want LiTT to build..."}
                    rows={1}
                    className="min-h-12 flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:text-white/30 sm:text-base"
                    style={{ color: D.textPrimary }}
                  />
                  <button onClick={submit} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl transition hover:scale-[1.05] active:scale-95"
                    style={{ background: D.accent, color: D.textOnAccent, boxShadow: `0 0 28px ${D.accent}40` }} aria-label="Open in Studio">
                    <Icon name="arrow" size={19} />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(MODE_CONFIG).filter(([key]) => key !== "chat").map(([key, config]) => (
                    <button key={key} onClick={() => setMode(key)}
                      className="rounded-full border px-3 py-2 text-[10px] font-bold transition hover:-translate-y-0.5"
                      style={{
                        borderColor: mode === key ? `${D.accent}80` : "rgba(255,255,255,0.08)",
                        background: mode === key ? `${D.accent}18` : "rgba(255,255,255,0.03)",
                        color: mode === key ? D.accent : "rgba(255,255,255,0.55)",
                      }}>
                      {config.label}
                    </button>
                  ))}
                  <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="flex items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-bold transition hover:-translate-y-0.5 disabled:opacity-50"
                    style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.55)" }}>
                    <Icon name="plus" size={12} /> {uploading ? "Uploading..." : "Upload"}
                  </button>
                  <button onClick={startVoice}
                    className="flex items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-bold transition hover:-translate-y-0.5"
                    style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.55)" }}>
                    <Icon name="message" size={12} className={listening ? "animate-pulse" : ""} style={{ color: listening ? D.accentRed : undefined }} />
                    {listening ? "Listening..." : "Voice"}
                  </button>
                </div>
              </div>
            </BorderBeam>
          </CursorSpotlight>
        </EntranceSection>

        {/* === Continue Working + System Status === */}
        <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
          {/* Continue Working */}
          <EntranceSection delay={0.14}>
            <CursorSpotlight>
              <GlassPanel hover className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: D.accentCyan }}>Continue Working</p>
                    <h2 className="mt-1 text-xl font-black" style={{ color: D.textPrimary }}>Pick up where you left off</h2>
                  </div>
                  <Link href="/projects" className="text-[10px] font-bold transition hover:opacity-80" style={{ color: D.accent }}>
                    View all <Icon name="arrow" size={11} className="inline" />
                  </Link>
                </div>

                {/* Active project card with visual preview */}
                {data?.project ? (
                  <Link href={`/studio?mission=${encodeURIComponent(`Continue work on ${data.project.repository}`)}`}
                    className="group mt-5 block overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.005]"
                    style={{ borderColor: "rgba(34,211,238,0.15)", background: "rgba(34,211,238,0.04)" }}>
                    {/* Preview area */}
                    <div className="relative h-32 overflow-hidden" style={{ background: "linear-gradient(135deg, #0d0b16, #151027)" }}>
                      <div className="absolute inset-0 opacity-20" style={{
                        backgroundImage: "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
                        backgroundSize: "32px 32px",
                      }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Icon name="code" size={36} style={{ color: "rgba(139,92,246,0.3)" }} />
                      </div>
                      <div className="absolute right-3 top-3 flex gap-1.5">
                        {data.project.workspaceState === "ready" && (
                          <span className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
                            style={{ borderColor: `${D.accentGreen}40`, background: `${D.accentGreen}15`, color: D.accentGreen }}>
                            Ready
                          </span>
                        )}
                        {data.project.deploymentState === "production" && (
                          <span className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
                            style={{ borderColor: `${D.accentCyan}40`, background: `${D.accentCyan}15`, color: D.accentCyan }}>
                            Live
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Project info */}
                    <div className="p-4">
                      <div className="truncate text-sm font-black" style={{ color: D.textPrimary }}>{data.project.repository}</div>
                      <div className="mt-1 flex items-center gap-3 text-[10px]" style={{ color: D.textMuted }}>
                        <span className="flex items-center gap-1"><Icon name="branch" size={10} />{data.project.branch}</span>
                        {data.project.latestCommit && <span>Commit {data.project.latestCommit.slice(0, 8)}</span>}
                        {data.project.updatedAt && <span>{timeAgo(data.project.updatedAt)}</span>}
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-[10px] font-bold transition group-hover:opacity-100" style={{ color: D.accentCyan, opacity: 0.7 }}>
                        Continue <Icon name="arrow" size={10} />
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="mt-5 rounded-2xl border border-dashed p-6 text-center" style={{ borderColor: `${D.accent}25`, background: `${D.accent}04` }}>
                    <Icon name="sparkles" size={24} className="mx-auto" style={{ color: D.accent }} />
                    <h3 className="mt-3 text-base font-black" style={{ color: D.textPrimary }}>Your first build starts here</h3>
                    <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: D.textMuted }}>
                      Describe an idea above, connect a GitHub repository, or let LiTT guide your workspace setup.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <button onClick={() => { setMode("builder"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                        className="rounded-xl px-4 py-2 text-xs font-black transition hover:scale-[1.02]" style={{ background: D.accent, color: D.textOnAccent }}>
                        Build something
                      </button>
                      <Link href="/projects" className="rounded-xl border px-4 py-2 text-xs font-black transition hover:opacity-80" style={{ borderColor: D.border, color: D.textMuted }}>
                        Connect GitHub
                      </Link>
                    </div>
                  </div>
                )}

                {/* Active missions */}
                {activeMissions.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {activeMissions.slice(0, 4).map((mission) => (
                      <MissionCard key={mission.id} mission={mission} />
                    ))}
                  </div>
                )}
              </GlassPanel>
            </CursorSpotlight>
          </EntranceSection>

          {/* System Status */}
          <EntranceSection delay={0.19}>
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Icon name="cpu" size={17} style={{ color: D.accentGreen }} />
                <h2 className="text-sm font-black" style={{ color: D.textPrimary }}>System</h2>
              </div>
              <div className="mt-4 divide-y divide-white/5">
                {systemStatuses.map((status) => {
                  const color = STATE_COLOR[status.state] || D.textDim;
                  const isHealthy = ["connected", "ready", "live", "operational", "healthy"].includes(status.state);
                  return (
                    <div key={status.label} className="flex items-center justify-between py-2.5">
                      <StatusPulse color={color} label={status.label} detail={status.detail} pulse={isHealthy} />
                    </div>
                  );
                })}
              </div>

              {/* LiTT status */}
              <div className="mt-4 rounded-xl border p-3" style={{ borderColor: `${D.accentGreen}25`, background: `${D.accentGreen}08` }}>
                <div className="flex items-center justify-between">
                  <StatusPulse color={D.accentGreen} label="LiTT" detail="Ready" pulse />
                  <Link href="/studio?tool=chat" className="text-[10px] font-black transition hover:opacity-80" style={{ color: D.accent }}>
                    Launch
                  </Link>
                </div>
              </div>

              {/* Media player */}
              <div className="mt-4">
                <MediaNowPlayingCard />
              </div>
            </GlassPanel>
          </EntranceSection>
        </div>

        {/* === Quick Launch === */}
        <EntranceSection delay={0.24}>
          <div className="mb-5 grid gap-3 grid-cols-2 lg:grid-cols-4">
            <QuickLaunchTile icon="code" label="BUILD" description="Build it" href="/studio?tool=code" accentColor={D.accent} />
            <QuickLaunchTile icon="image" label="CREATE" description="Make it" href="/studio?tool=image" accentColor={D.accentCyan} />
            <QuickLaunchTile icon="bot" label="AGENTS" description="Run crew" href="/studio?tool=agents" accentColor={D.accentGreen} />
            <QuickLaunchTile icon="rocket" label="DEPLOY" description="Ship it" href="/deployments" accentColor={D.accentAmber} />
          </div>
        </EntranceSection>

        {/* === LiTT Operations === */}
        <EntranceSection delay={0.28}>
          <GlassPanel className="mb-5 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Icon name="cpu" size={17} style={{ color: D.accentCyan }} />
              <h2 className="text-sm font-black" style={{ color: D.textPrimary }}>LiTT Operations</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* Browser Agent */}
              <div className="rounded-xl border p-3" style={{ borderColor: `${D.accentCyan}15`, background: `${D.accentCyan}04` }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: D.textMuted }}>Browser Agent</span>
                  <StatusPulse color={D.textDim} label="" detail="Idle" />
                </div>
              </div>
              {/* Voice / Vapi */}
              <div className="rounded-xl border p-3" style={{ borderColor: `${D.accentGreen}15`, background: `${D.accentGreen}04` }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: D.textMuted }}>Voice / Vapi</span>
                  <StatusPulse color={D.accentGreen} label="" detail="Online" pulse />
                </div>
              </div>
              {/* GHL / CRM */}
              <div className="rounded-xl border p-3" style={{ borderColor: `${D.accentAmber}15`, background: `${D.accentAmber}04` }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: D.textMuted }}>GHL / CRM</span>
                  <StatusPulse color={D.accentAmber} label="" detail="Connected" />
                </div>
              </div>
              {/* Runtime */}
              <div className="rounded-xl border p-3" style={{ borderColor: `${D.accent}15`, background: `${D.accent}04` }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold" style={{ color: D.textMuted }}>Runtime</span>
                  <StatusPulse color={data?.project?.terminalState === "connected" ? D.accentGreen : D.textDim} label="" detail={data?.project?.terminalState === "connected" ? "Ready" : "Offline"} pulse={data?.project?.terminalState === "connected"} />
                </div>
              </div>
            </div>
            {/* Approvals */}
            {urgentCount > 0 && (
              <Link href="/studio?tool=agents" className="mt-3 flex items-center justify-between rounded-xl border p-3 transition hover:opacity-80"
                style={{ borderColor: `${D.accentAmber}25`, background: `${D.accentAmber}08` }}>
                <span className="text-[11px] font-bold" style={{ color: D.accentAmber }}>Approvals</span>
                <span className="text-[11px] font-black" style={{ color: D.accentAmber }}>{urgentCount} waiting →</span>
              </Link>
            )}
          </GlassPanel>
        </EntranceSection>

        {/* === Recent Activity + Usage === */}
        <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
          {/* Recent Activity */}
          <EntranceSection delay={0.30}>
            <CursorSpotlight>
              <GlassPanel className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.2em]" style={{ color: D.accentCyan }}>Recent Activity</p>
                    <h2 className="mt-1 text-lg font-black" style={{ color: D.textPrimary }}>Platform and project events</h2>
                  </div>
                </div>
                <div className="mt-4 divide-y divide-white/5">
                  {(data?.activity ?? []).slice(0, 8).map((event) => {
                    const color = event.severity === "error" ? D.accentRed : event.severity === "warning" ? D.accentAmber : event.severity === "success" ? D.accentGreen : D.accentCyan;
                    return (
                      <div key={event.id} className="group flex items-start gap-3 py-3 transition-all first:pt-0 last:pb-0 hover:bg-white/[0.02] hover:px-2 hover:rounded-lg">
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full transition group-hover:scale-125" style={{ background: color, boxShadow: `0 0 8px ${color}60` }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold" style={{ color: D.textPrimary }}>{event.title}</div>
                          {event.detail && <div className="mt-1 truncate text-xs" style={{ color: D.textMuted }}>{event.detail}</div>}
                        </div>
                        <time className="shrink-0 text-[10px]" style={{ color: D.textDim }}>{formatTime(event.createdAt)}</time>
                      </div>
                    );
                  })}
                  {!data?.activity?.length && (
                    <div className="py-8 text-center">
                      <div className="text-xs font-bold" style={{ color: D.textMuted }}>No recent activity</div>
                      <p className="mt-1 text-[11px]" style={{ color: D.textDim }}>Activity from missions, builds, and deploys will appear here.</p>
                    </div>
                  )}
                </div>
              </GlassPanel>
            </CursorSpotlight>
          </EntranceSection>

          {/* Usage / Bits */}
          <EntranceSection delay={0.35}>
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Icon name="zap" size={17} style={{ color: D.accent }} />
                <h2 className="text-sm font-black" style={{ color: D.textPrimary }}>Usage / BITS</h2>
              </div>
              <div className="mt-4">
                <div className="text-3xl font-black" style={{ color: D.textPrimary }}>{balance.toLocaleString()}</div>
                <div className="mt-1 text-xs" style={{ color: D.textMuted }}>{plan} plan</div>
                {/* Usage bar */}
                <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: D.skeleton }}>
                  <div className="h-full rounded-full" style={{
                    width: `${Math.min(100, Math.max(8, (balance / 1000) * 100))}%`,
                    background: `linear-gradient(to right, ${D.accent}, ${D.accentCyan})`,
                  }} />
                </div>
                {/* Key counts */}
                <div className="mt-5 space-y-2 text-xs" style={{ color: D.textMuted }}>
                  <div className="flex items-center justify-between">
                    <span>LiTT runs</span>
                    <span className="font-bold" style={{ color: D.textPrimary }}>{(data?.missions ?? []).length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Deployments</span>
                    <span className="font-bold" style={{ color: D.textPrimary }}>{(data?.activity ?? []).filter((a) => a.category === "deployment").length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Needs attention</span>
                    <span className="font-bold" style={{ color: urgentCount > 0 ? D.accentRed : D.textPrimary }}>{urgentCount}</span>
                  </div>
                </div>
              </div>
            </GlassPanel>
          </EntranceSection>
        </div>

        {/* === Draggable Widget Grid === */}
        <EntranceSection delay={0.40}>
          <DraggableWidgetGrid data={data} widgetData={widgetData} ownerMode={ownerMode} />
        </EntranceSection>
      </div>
    </main>
  );
}

/** Theme toggle for the dashboard header. */
function ThemeToggle() {
  const { theme, toggleTheme } = useDashboardTheme();
  const isLight = theme === "light";
  return (
    <button type="button" onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition hover:scale-105 active:scale-95"
      style={{ borderColor: isLight ? `${D.accentAmber}40` : D.borderStrong, background: isLight ? `${D.accentAmber}12` : D.surface, color: isLight ? D.accentAmber : D.textMuted }}
      aria-label={`Switch to ${isLight ? "dark" : "light"} theme`}>
      <Icon name={isLight ? "moon" : "sun"} size={14} />
    </button>
  );
}

export default MissionControlDashboard;
