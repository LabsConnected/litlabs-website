"use client";

import { useState } from "react";
import { Activity, Bell, MessageSquare, Play, Sparkles } from "lucide-react";
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
import { ProfileWidget } from "./widgets/ProfileWidget";
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

  const submit = (mode: "chat" | "run") => {
    const prompt = composer.trim();
    if (!prompt) return;
    setComposer("");
    if (mode === "run") onRunPrompt(prompt);
    else onPrompt(prompt);
  };

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto px-4 pb-3 pt-1">
      {/* Hero header with composer */}
      <section
        className="relative overflow-hidden rounded-2xl border p-4 sm:p-5"
        style={{
          backgroundColor: `${LC.bgPanel}e6`,
          borderColor: LC.border,
          boxShadow: LC_SHADOW.panel,
        }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div
              className="mb-2 flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{
                borderColor: `${LC.accentCyan}33`,
                color: LC.accentCyan,
                backgroundColor: `${LC.accentCyan}10`,
              }}
            >
              <Sparkles size={13} />
              Creator OS online
            </div>
            <h1 className="text-2xl font-black tracking-normal sm:text-3xl" style={{ color: LC.text }}>
              LiT Console command center
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: LC.textMuted }}>
              Your creator OS is live. Agents, tools, social feed, telemetry, and terminal — all in one workspace. LiT is always here to help.
            </p>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
            <StatusChip label={`${activeAgent} online`} tone="cyan" />
            <StatusChip label={activeModel} tone="orange" />
            <StatusChip label="litlabs active" tone="green" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div
            className="flex min-w-0 flex-col gap-2 rounded-xl border p-2 sm:flex-row"
            style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
          >
            <input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(e.shiftKey ? "run" : "chat");
              }}
              placeholder="Ask LiT, start a build, or describe the next move..."
              className="min-h-10 flex-1 bg-transparent px-2 text-sm outline-none"
              style={{ color: LC.text }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => submit("chat")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold sm:flex-none"
                style={{ backgroundColor: `${LC.accentCyan}18`, color: LC.accentCyan }}
              >
                <MessageSquare size={14} /> Chat
              </button>
              <button
                onClick={() => submit("run")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold sm:flex-none"
                style={{ backgroundColor: LC.accentOrange, color: "#000" }}
              >
                <Play size={14} /> Run
              </button>
            </div>
          </div>
          <button
            onClick={onOpenTerminal}
            className="rounded-xl border px-4 py-3 text-xs font-bold uppercase tracking-[0.14em]"
            style={{
              borderColor: `${LC.accentOrange}35`,
              color: LC.accentOrange,
              backgroundColor: `${LC.accentOrange}10`,
            }}
          >
            Open terminal drawer
          </button>
        </div>
      </section>

      {/* Main grid: 3 columns */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        {/* LEFT COLUMN: Telemetry + Quick Access + Agent Discovery */}
        <div className="flex flex-col gap-4">
          <TelemetryWidget />
          <QuickAccessWidget />
          <AgentDiscoveryWidget />
        </div>

        {/* CENTER COLUMN: Start Here + Profile + Social Feed + Games + Agents */}
        <div className="flex flex-col gap-4">
          <LittMiniWidget />
          <ProfileWidget />
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
          <SocialFeedWidget />
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
