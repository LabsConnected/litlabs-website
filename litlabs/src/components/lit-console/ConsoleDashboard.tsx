"use client";

import { useState } from "react";
import { Activity, Bell, MessageSquare, Play, Sparkles, LayoutGrid, MessageSquareText, User } from "lucide-react";
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

export default function ConsoleDashboard({
  activeAgent,
  activeModel,
  onPrompt,
  onRunPrompt,
  onOpenChat,
  onOpenTerminal,
}: ConsoleDashboardProps) {
  const [composer, setComposer] = useState("");
  const [tab, setTab] = useState<"command" | "social" | "profile">("command");

  const tabs = [
    { id: "command" as const, label: "Command Center", icon: LayoutGrid },
    { id: "social" as const, label: "Social Feed", icon: MessageSquareText },
    { id: "profile" as const, label: "My Profile", icon: User },
  ];

  const submit = (mode: "chat" | "run") => {
    const prompt = composer.trim();
    if (!prompt) return;
    setComposer("");
    if (mode === "run") onRunPrompt(prompt);
    else onPrompt(prompt);
  };

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto px-3 pb-3 pt-2">
      {/* Hero header — compact command bar */}
      <section
        className="relative overflow-hidden rounded-2xl border px-4 py-3"
        style={{
          backgroundColor: `${LC.bgPanel}e6`,
          borderColor: LC.border,
          boxShadow: LC_SHADOW.panel,
        }}
      >
        {/* Title row + status chips */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
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

        {/* Composer row */}
        <div className="flex min-w-0 items-center gap-2 rounded-xl border p-2"
          style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
        >
          <input
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(e.shiftKey ? "run" : "chat"); }}
            placeholder="Ask LiT, start a build, or describe the next move..."
            className="min-h-8 flex-1 bg-transparent px-2 text-sm outline-none"
            style={{ color: LC.text }}
          />
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => submit("chat")}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ backgroundColor: `${LC.accentCyan}18`, color: LC.accentCyan }}
            >
              <MessageSquare size={13} /> Chat
            </button>
            <button
              onClick={() => submit("run")}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ backgroundColor: LC.accentOrange, color: "#000" }}
            >
              <Play size={13} /> Run
            </button>
            <button
              onClick={onOpenTerminal}
              className="hidden sm:flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold"
              style={{ borderColor: `${LC.accentOrange}35`, color: LC.accentOrange, backgroundColor: `${LC.accentOrange}10` }}
            >
              Terminal
            </button>
          </div>
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
