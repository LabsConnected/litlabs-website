"use client";

import { useState } from "react";
import { Activity, Bell, Sparkles, LayoutGrid, MessageSquareText, User, SendHorizonal, Terminal, Image, Music, Code2, Globe, Gamepad2, ChevronRight, Zap } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import StarterActions from "./StarterActions";
import { ActiveAgentsWidget } from "./widgets/ActiveAgentsWidget";
import { DailyMissionsWidget } from "./widgets/DailyMissionsWidget";
import { GameArcadeWidget } from "./widgets/GameArcadeWidget";
import { LittMiniWidget } from "./widgets/LittMiniWidget";
import { ProjectsWidget } from "./widgets/ProjectsWidget";
import { TerminalLauncherWidget } from "./widgets/TerminalLauncherWidget";
import { TelemetryWidget } from "./widgets/TelemetryWidget";
import { QuickAccessWidget } from "./widgets/QuickAccessWidget";
import { SocialFeedWidget } from "./widgets/SocialFeedWidget";
import { ProfilePanel } from "./widgets/ProfilePanel";
import { AgentDiscoveryWidget, SystemStatusWidget } from "./widgets/AgentDiscoveryWidget";
import { LiveTelemetryWidget } from "./widgets/LiveTelemetryWidget";
import { LC, LC_SHADOW } from "./lit-console-theme";
import Link from "next/link";

type ConsoleDashboardProps = {
  activeAgent: string;
  activeModel: string;
  onPrompt: (prompt: string) => void;
  onRunPrompt: (prompt: string) => void;
  onOpenChat: () => void;
  onOpenTerminal: () => void;
};

const recentRuns = [
  { id: "plan", label: "Console revival plan", status: "ready", agent: "Director" },
  { id: "games", label: "Game arcade wiring", status: "building", agent: "Code Champ" },
  { id: "litt", label: "LiTT hub context", status: "online", agent: "LiTT" },
];

const updates = [
  "Social Dom queued gallery remix ideas.",
  "Director recommends finishing the shared OS shell first.",
  "Code Champ is watching build, lint, and route health.",
];

const QUICK_ACTIONS = [
  { label: "Code", icon: Code2, prompt: "Help me write code", color: "#22d3ee" },
  { label: "Image", icon: Image, prompt: "Generate an image", color: "#e879f9" },
  { label: "Website", icon: Globe, prompt: "Build a website", color: "#f472b6" },
  { label: "Music", icon: Music, prompt: "Create music", color: "#fb923c" },
  { label: "Terminal", icon: Terminal, prompt: "Open terminal", color: "#4ade80", href: "/lit-console" },
  { label: "Games", icon: Gamepad2, prompt: "", color: "#a78bfa", href: "/games/cloud" },
];

const MOBILE_AGENTS = [
  { id: "director", name: "Director", emoji: "🤖", status: "online", task: "Planning" },
  { id: "forge", name: "Forge", emoji: "⚡", status: "online", task: "Building" },
  { id: "pixel-forge", name: "Visionary", emoji: "🎨", status: "idle", task: "Ready" },
  { id: "music-producer", name: "Producer", emoji: "🎵", status: "idle", task: "Idle" },
];

function MobileConsoleDashboard({
  onPrompt,
  onOpenChat,
  onOpenTerminal,
}: {
  onPrompt: (p: string) => void;
  onOpenChat: () => void;
  onOpenTerminal: () => void;
}) {
  const [inputVal, setInputVal] = useState("");

  const handleSubmit = () => {
    if (!inputVal.trim()) return;
    onPrompt(inputVal);
    setInputVal("");
    onOpenChat();
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4" style={{ backgroundColor: LC.bg }}>
      {/* ── GREETING + INPUT ── */}
      <div className="px-4 pt-6 pb-4 space-y-5">
        {/* Status pill */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: LC.accentCyan }}>
            LiT Online
          </span>
        </div>

        {/* Greeting */}
        <div>
          <p className="text-xs font-bold" style={{ color: LC.textMuted }}>{greeting}</p>
          <h1 className="text-2xl font-black mt-0.5 leading-tight" style={{ color: LC.text }}>
            What are we<br />
            <span style={{ color: LC.accentCyan }}>building?</span>
          </h1>
        </div>

        {/* Chat input */}
        <div
          className="flex items-center gap-2 rounded-2xl border px-4 py-3"
          style={{ backgroundColor: LC.bgPanel, borderColor: `${LC.accentCyan}30`, boxShadow: LC_SHADOW.glowCyan }}
        >
          <input
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Ask LiT anything..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
            style={{ color: LC.text }}
          />
          <button
            onClick={handleSubmit}
            className="rounded-xl p-2 transition-all active:scale-95"
            style={{ backgroundColor: inputVal.trim() ? LC.accentCyan : `${LC.accentCyan}20`, color: inputVal.trim() ? "#000" : LC.accentCyan }}
          >
            <SendHorizonal size={16} />
          </button>
        </div>

        {/* Quick action chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            const inner = (
              <button
                key={a.label}
                onClick={() => a.prompt && onPrompt(a.prompt)}
                className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition-all active:scale-95"
                style={{ backgroundColor: `${a.color}15`, border: `1px solid ${a.color}30`, color: a.color }}
              >
                <Icon size={13} />
                {a.label}
              </button>
            );
            return a.href ? (
              <Link key={a.label} href={a.href}>{inner}</Link>
            ) : inner;
          })}
        </div>
      </div>

      {/* ── AGENTS ROW ── */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: LC.textMuted }}>Agents</span>
          <Link href="/littree" className="flex items-center gap-1 text-[10px] font-bold" style={{ color: LC.accentCyan }}>
            All <ChevronRight size={10} />
          </Link>
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {MOBILE_AGENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => onPrompt(`Ask ${a.name}: `)}
              className="shrink-0 flex flex-col items-center gap-1.5 rounded-2xl border p-3 min-w-[72px] transition-all active:scale-95"
              style={{
                backgroundColor: LC.bgPanel,
                borderColor: a.status === "online" ? `${LC.accentCyan}40` : `${LC.border}`,
              }}
            >
              <span className="text-2xl">{a.emoji}</span>
              <span className="text-[10px] font-black" style={{ color: LC.text }}>{a.name}</span>
              <span
                className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: a.status === "online" ? `${LC.accentCyan}20` : `${LC.border}40`,
                  color: a.status === "online" ? LC.accentCyan : LC.textMuted,
                }}
              >
                {a.task}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── GAMES ROW ── */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: LC.textMuted }}>Games</span>
          <Link href="/games/cloud" className="flex items-center gap-1 text-[10px] font-bold" style={{ color: LC.accentCyan }}>
            All <ChevronRight size={10} />
          </Link>
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {[
            { emoji: "🕹", name: "Pac-Man", cat: "arcade" },
            { emoji: "🐍", name: "Snake", cat: "arcade" },
            { emoji: "🟦", name: "Tetris", cat: "puzzle" },
            { emoji: "🦖", name: "Chrome Dino", cat: "arcade" },
            { emoji: "📝", name: "Wordle", cat: "word" },
            { emoji: "♟", name: "Chess", cat: "classic" },
          ].map((g) => (
            <Link
              key={g.name}
              href="/games/cloud"
              className="shrink-0 flex flex-col items-center gap-1.5 rounded-xl border p-3 min-w-[64px] active:scale-95"
              style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
            >
              <span className="text-xl">{g.emoji}</span>
              <span className="text-[9px] font-black text-center leading-tight" style={{ color: LC.text }}>{g.name}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── LIVE ACTIVITY ── */}
      <div className="px-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={11} style={{ color: LC.accentOrange }} />
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: LC.textMuted }}>Live Activity</span>
        </div>
        <div
          className="rounded-2xl border p-3 space-y-2"
          style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
        >
          {[
            { dot: "#22d3ee", text: "Director finished planning console layout." },
            { dot: "#e879f9", text: "Visionary generated 3 new wallpapers." },
            { dot: "#4ade80", text: "Forge deployed latest build to production." },
            { dot: "#fb923c", text: "New game added to Game Cloud." },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: item.dot }} />
              <p className="text-xs leading-relaxed" style={{ color: LC.textMuted }}>{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── STATUS PILL ── */}
      <div className="px-4">
        <div
          className="rounded-2xl border px-4 py-3 flex items-center justify-between"
          style={{ backgroundColor: LC.bgPanel, borderColor: `${LC.accentCyan}20` }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs font-bold" style={{ color: LC.text }}>All Systems Online</span>
          </div>
          <div className="flex items-center gap-3 text-[10px]" style={{ color: LC.textMuted }}>
            <span>10 Agents</span>
            <span>·</span>
            <span>25 Games</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ConsoleDashboard({
  activeAgent,
  activeModel,
  onPrompt,
  onRunPrompt,
  onOpenChat,
  onOpenTerminal,
}: ConsoleDashboardProps) {
  const [tab, setTab] = useState<"command" | "social" | "profile">("command");

  const tabs = [
    { id: "command" as const, label: "Command Center", icon: LayoutGrid },
    { id: "social" as const, label: "Social Feed", icon: MessageSquareText },
    { id: "profile" as const, label: "My Profile", icon: User },
  ];

  return (
    <>
      {/* ── MOBILE: chat-first layout ── */}
      <div className="md:hidden h-full">
        <MobileConsoleDashboard
          onPrompt={onPrompt}
          onOpenChat={onOpenChat}
          onOpenTerminal={onOpenTerminal}
        />
      </div>

      {/* ── DESKTOP: existing grid ── */}
      <div className="hidden md:flex h-full w-full flex-col gap-3 overflow-y-auto px-3 pb-3 pt-2">
      {/* Hero header — status bar only */}
      <section
        className="relative overflow-hidden rounded-2xl border px-4 py-2.5"
        style={{
          backgroundColor: `${LC.bgPanel}e6`,
          borderColor: LC.border,
          boxShadow: LC_SHADOW.panel,
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            <div
              className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ borderColor: `${LC.accentCyan}33`, color: LC.accentCyan, backgroundColor: `${LC.accentCyan}10` }}
            >
              <Sparkles size={11} />
              Creator OS online
            </div>
            <h1 className="text-sm font-black tracking-wide" style={{ color: LC.text }}>
              LiT Console
            </h1>
          </div>
          <StatusChip label={`${activeAgent} online`} tone="cyan" />
          <StatusChip label={activeModel} tone="orange" />
          <StatusChip label="litlabs active" tone="green" />
        </div>
      </section>

      {/* Tabs — sticky */}
      <div className="sticky top-0 z-10 flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: LC.border, backgroundColor: LC.bgPanel }}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-bold transition-all"
            style={{
              backgroundColor: tab === id ? `${LC.accentCyan}18` : "transparent",
              color: tab === id ? LC.accentCyan : LC.textMuted,
              border: `1px solid ${tab === id ? `${LC.accentCyan}30` : "transparent"}`,
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* TAB: Command Center */}
      {tab === "command" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.4fr)_minmax(220px,0.7fr)]">
          {/* LEFT COLUMN: Telemetry + Quick Access + Agent Discovery */}
          <div className="flex flex-col gap-4">
            <TelemetryWidget />
            <QuickAccessWidget />
            <AgentDiscoveryWidget />
          </div>

          {/* CENTER COLUMN: Start Here + Litt + Games + Agents */}
          <div className="flex flex-col gap-4">
            <LittMiniWidget />
            <BentoCard
              title="Start Here"
              icon={<Sparkles size={14} />}
              action={
                <button
                  onClick={onOpenChat}
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: LC.accentCyan }}
                >
                  Open Chat
                </button>
              }
            >
              <StarterActions onSelect={onPrompt} />
            </BentoCard>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <GameArcadeWidget />
              <ActiveAgentsWidget />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TerminalLauncherWidget />
              <ProjectsWidget />
            </div>
            <DailyMissionsWidget />
          </div>

          {/* RIGHT COLUMN: Live Telemetry + Recent Runs + Updates + System Status */}
          <div className="flex flex-col gap-4">
            <LiveTelemetryWidget />
            <BentoCard title="Recent Runs" icon={<Activity size={14} />}>
              <div className="flex flex-col gap-2">
                {recentRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => onPrompt(`Open ${run.label}`)}
                    className="flex items-center justify-between rounded-xl border p-3 text-left"
                    style={{ borderColor: `${LC.border}cc`, backgroundColor: LC.bgSecondary }}
                  >
                    <div>
                      <div className="text-sm font-bold" style={{ color: LC.text }}>
                        {run.label}
                      </div>
                      <div className="text-[10px]" style={{ color: LC.textMuted }}>
                        {run.agent}
                      </div>
                    </div>
                    <span
                      className="rounded-full px-2 py-1 text-[10px] font-bold"
                      style={{
                        color: run.status === "building" ? LC.accentOrange : LC.success,
                        backgroundColor: run.status === "building" ? `${LC.accentOrange}18` : `${LC.success}18`,
                      }}
                    >
                      {run.status}
                    </span>
                  </button>
                ))}
              </div>
            </BentoCard>
            <BentoCard title="Social Dom Updates" icon={<Bell size={14} />}>
              <div className="flex flex-col gap-2">
                {updates.map((update) => (
                  <div
                    key={update}
                    className="rounded-xl border p-3 text-sm leading-relaxed"
                    style={{ borderColor: `${LC.border}cc`, backgroundColor: LC.bgSecondary, color: LC.textMuted }}
                  >
                    {update}
                  </div>
                ))}
              </div>
            </BentoCard>
            <SystemStatusWidget />
          </div>
        </div>
      )}

      {/* TAB: Social Feed */}
      {tab === "social" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <SocialFeedWidget />
          <div className="flex flex-col gap-4">
            <BentoCard title="Trending" icon={<Sparkles size={14} />}>
              <div className="flex flex-col gap-2">
                {["#AIAgents", "#CodeChampion", "#LiTTreeLabStudios", "#AgentBuilder", "#NeonVibes"].map((tag, i) => (
                  <div key={tag} className="flex items-center justify-between rounded-lg border p-2" style={{ borderColor: `${LC.border}40`, backgroundColor: LC.bgSecondary }}>
                    <span className="text-[11px] font-bold" style={{ color: LC.textMuted }}>{tag}</span>
                    <span className="text-[10px]" style={{ color: LC.accentCyan }}>#{i + 1}</span>
                  </div>
                ))}
              </div>
            </BentoCard>
            <BentoCard title="Community" icon={<Activity size={14} />}>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border p-2" style={{ borderColor: `${LC.border}40`, backgroundColor: LC.bgSecondary }}>
                  <div className="text-lg font-black" style={{ color: LC.accentCyan }}>4</div>
                  <div className="text-[9px] uppercase" style={{ color: LC.textMuted }}>Posts</div>
                </div>
                <div className="rounded-lg border p-2" style={{ borderColor: `${LC.border}40`, backgroundColor: LC.bgSecondary }}>
                  <div className="text-lg font-black" style={{ color: LC.accentOrange }}>140</div>
                  <div className="text-[9px] uppercase" style={{ color: LC.textMuted }}>Likes</div>
                </div>
              </div>
            </BentoCard>
            <AgentDiscoveryWidget />
          </div>
        </div>
      )}

      {/* TAB: Profile */}
      {tab === "profile" && <ProfilePanel />}
      </div>
    </>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "cyan" | "orange" | "green" }) {
  const color = tone === "cyan" ? LC.accentCyan : tone === "orange" ? LC.accentOrange : LC.success;

  return (
    <div
      className="min-w-0 rounded-xl border px-3 py-2 text-[11px] font-bold"
      style={{ borderColor: `${color}35`, color, backgroundColor: `${color}10` }}
    >
      <span className="block truncate">{label}</span>
    </div>
  );
}
