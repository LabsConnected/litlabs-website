"use client";

import { useTheme } from "@/context/ThemeContext";
import {
  Coins,
  Music,
  Activity,
  Users,
  Plus,
  Monitor,
  Check,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { AGENTS as REAL_AGENTS } from "@/lib/agents";
import { CREATORS } from "./dashboard-data";

const AGENT_COLORS = [
  "#00ffff",
  "#ff0080",
  "#00ff41",
  "#ff6b6b",
  "#ffff00",
  "#ff9ff3",
  "#3b82f6",
  "#ec4899",
  "#06b6d4",
  "#f59e0b",
  "#22d3ee",
  "#8b5cf6",
];

const AGENTS = Object.values(REAL_AGENTS).map((a, i) => ({
  name: a.name,
  status:
    a.status === "busy"
      ? ("working" as const)
      : a.status === "offline"
        ? ("idle" as const)
        : ("online" as const),
  task: a.role,
  color: AGENT_COLORS[i % AGENT_COLORS.length],
}));

export function TelemetryDot({
  label,
  status,
  color,
}: {
  label: string;
  status: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="relative w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      >
        <span
          className="absolute inset-0 rounded-full animate-ping opacity-30"
          style={{ backgroundColor: color }}
        />
      </span>
      <div>
        <div
          className="text-[10px] font-mono uppercase tracking-wider"
          style={{ color }}
        >
          {label}
        </div>
        <div className="text-[9px] opacity-60" style={{ color }}>
          {status}
        </div>
      </div>
    </div>
  );
}

export default function DashboardWidgets({
  displayName,
  balance,
  claimed,
  visitors,
  onClaimAction,
}: {
  displayName: string;
  balance: number;
  claimed: boolean;
  visitors: number;
  onClaimAction: () => void;
}) {
  const { resolvedColors: T } = useTheme();

  return (
    <aside
      className="hidden xl:flex flex-col gap-4 w-80 shrink-0 p-4 border-r overflow-y-auto"
      style={{
        borderColor: `${T.borderColor}30`,
        backgroundColor: `${T.bgColor}60`,
      }}
    >
      {/* Profile Mini */}
      <GlassCard variant="flat" padding="sm" radius="lg">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black"
            style={{
              backgroundColor: `${T.accentColor}20`,
              border: `1px solid ${T.accentColor}40`,
              color: T.accentColor,
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div
              className="text-sm font-bold truncate"
              style={{ color: T.textColor }}
            >
              {displayName}
            </div>
            <div
              className="text-[10px] font-mono uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Creator
            </div>
          </div>
          <div
            className="ml-auto flex items-center gap-1 text-xs font-bold"
            style={{ color: T.accentColor }}
          >
            <Coins size={12} /> {balance.toLocaleString()}
          </div>
        </div>
      </GlassCard>

      {/* Now Playing */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        header={
          <div
            className="text-[10px] font-mono uppercase tracking-wider flex items-center justify-between"
            style={{ color: T.textMuted }}
          >
            <div className="flex items-center gap-2">
              <Music size={12} /> Live Radio
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          </div>
        }
      >
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}30, ${T.accentColor}10)`,
              border: `1px solid ${T.accentColor}40`,
            }}
          >
            <Music size={24} style={{ color: T.accentColor }} />
            <div
              className="absolute inset-0 opacity-20"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${T.accentColor}, transparent 70%)`,
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-sm font-bold truncate"
              style={{ color: T.headerColor }}
            >
              Neon Horizon
            </div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>
              Synthwave Radio
            </div>
            <div
              className="mt-1.5 h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: `${T.accentColor}20` }}
            >
              <div
                className="h-full rounded-full animate-pulse"
                style={{
                  backgroundColor: T.accentColor,
                  width: "60%",
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            {[3, 4, 5, 4, 3].map((h, i) => (
              <span
                key={i}
                className="w-1 rounded-full animate-pulse"
                style={{
                  backgroundColor: T.accentColor,
                  height: `${h * 3}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
        </div>
      </GlassCard>

      {/* Agent Queue */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        header={
          <div
            className="text-[10px] font-mono uppercase tracking-wider flex items-center justify-between"
            style={{ color: T.textMuted }}
          >
            <div className="flex items-center gap-2">
              <Activity size={12} /> Agent Cluster
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[9px]">
                {
                  AGENTS.filter(
                    (a) => a.status === "online" || a.status === "working",
                  ).length
                }{" "}
                Active
              </span>
            </div>
          </div>
        }
      >
        <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
          {AGENTS.map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-3 group cursor-pointer hover:bg-white/5 rounded-lg p-1.5 -mx-1.5 transition-colors"
            >
              <span
                className="relative w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: a.color }}
              >
                {a.status === "working" && (
                  <span
                    className="absolute inset-0 rounded-full animate-ping opacity-50"
                    style={{ backgroundColor: a.color }}
                  />
                )}
                {a.status === "online" && (
                  <span
                    className="absolute inset-0 rounded-full opacity-30"
                    style={{
                      backgroundColor: a.color,
                      boxShadow: `0 0 6px ${a.color}`,
                    }}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-bold flex items-center gap-1"
                  style={{ color: T.textColor }}
                >
                  {a.name}
                </div>
                <div className="text-[9px]" style={{ color: T.textMuted }}>
                  {a.task}
                </div>
              </div>
              <span
                className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded-md"
                style={{
                  backgroundColor: `${a.color}20`,
                  color: a.color,
                  border: `1px solid ${a.color}40`,
                }}
              >
                {a.status}
              </span>
            </div>
          ))}
        </div>
        <div
          className="mt-3 pt-3 border-t border-white/10 flex justify-between text-[9px]"
          style={{ color: T.textMuted }}
        >
          <span>
            Working: {AGENTS.filter((a) => a.status === "working").length}
          </span>
          <span>Idle: {AGENTS.filter((a) => a.status === "idle").length}</span>
        </div>
      </GlassCard>

      {/* Daily Reward */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        className={claimed ? "opacity-70" : ""}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: claimed
                ? `linear-gradient(135deg, ${T.success}20, ${T.success}10)`
                : `linear-gradient(135deg, ${T.accentColor}30, ${T.accentColor}15)`,
              border: `1px solid ${claimed ? `${T.success}40` : `${T.accentColor}40`}`,
            }}
          >
            <Coins
              size={22}
              style={{ color: claimed ? T.success : T.accentColor }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: T.textColor }}>
              {claimed ? "Reward Claimed!" : "Daily Reward"}
            </div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>
              {claimed ? "Come back tomorrow for more" : "+50 LiTBit Coins"}
            </div>
            <div className="mt-1.5">
              <button
                onClick={onClaimAction}
                disabled={claimed}
                className="w-full px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  backgroundColor: claimed
                    ? `${T.success}20`
                    : `${T.accentColor}25`,
                  color: claimed ? T.success : T.accentColor,
                  border: `1px solid ${claimed ? `${T.success}50` : `${T.accentColor}50`}`,
                }}
              >
                {claimed ? (
                  <span className="flex items-center justify-center gap-1">
                    <Check size={12} /> Claimed
                  </span>
                ) : (
                  "Claim Now"
                )}
              </button>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Suggested Creators */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        header={
          <div
            className="text-[10px] font-mono uppercase tracking-wider flex items-center justify-between"
            style={{ color: T.textMuted }}
          >
            <div className="flex items-center gap-2">
              <Users size={12} /> Top Creators
            </div>
            <span className="text-[9px] opacity-50">{CREATORS.length}</span>
          </div>
        }
      >
        <div className="space-y-3">
          {CREATORS.map((c) => (
            <div
              key={c.handle}
              className="flex items-center gap-3 group cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 transition-transform group-hover:scale-105"
                style={{
                  backgroundColor: `${c.color}20`,
                  color: c.color,
                  border: `1px solid ${c.color}40`,
                }}
              >
                {c.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-bold flex items-center gap-1"
                  style={{ color: T.textColor }}
                >
                  {c.name}
                  <span className="text-[9px] opacity-40">• {c.followers}</span>
                </div>
                <div className="text-[10px]" style={{ color: T.textMuted }}>
                  {c.handle}
                </div>
              </div>
              <button
                className="p-1.5 rounded-md transition-all hover:opacity-80 hover:bg-white/5"
                style={{ color: c.color }}
                title="Follow"
              >
                <Plus size={14} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* System Status */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        header={
          <div
            className="text-[10px] font-mono uppercase tracking-wider flex items-center justify-between"
            style={{ color: T.textMuted }}
          >
            <span>System Status</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[9px] text-green-400">All Operational</span>
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "AI Models", status: "Online", color: T.success },
            { label: "Agent Chat", status: "Online", color: T.success },
            { label: "Image Gen", status: "Online", color: T.success },
            { label: "Video Studio", status: "Online", color: T.success },
            { label: "Marketplace", status: "Online", color: T.success },
            { label: "Code Agent", status: "Online", color: T.success },
          ].map((service) => (
            <div
              key={service.label}
              className="flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: service.color }}
              />
              <div className="min-w-0">
                <div
                  className="text-[9px] font-mono uppercase truncate"
                  style={{ color: T.textColor }}
                >
                  {service.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-3">
        <GlassCard variant="flat" padding="sm" radius="lg">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${T.accentColor}15`,
                border: `1px solid ${T.accentColor}30`,
              }}
            >
              <Monitor size={14} style={{ color: T.accentColor }} />
            </div>
            <div>
              <div
                className="text-lg font-mono font-bold leading-none"
                style={{ color: T.headerColor }}
              >
                {visitors.toLocaleString()}
              </div>
              <div className="text-[9px]" style={{ color: T.textMuted }}>
                Visitors
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard variant="flat" padding="sm" radius="lg">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${T.success}15`,
                border: `1px solid ${T.success}30`,
              }}
            >
              <Activity size={14} style={{ color: T.success }} />
            </div>
            <div>
              <div
                className="text-lg font-mono font-bold leading-none"
                style={{ color: T.headerColor }}
              >
                {AGENTS.filter((a) => a.status === "working").length}
              </div>
              <div className="text-[9px]" style={{ color: T.textMuted }}>
                Active Tasks
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </aside>
  );
}
