"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  Coins,
  Activity,
  Users,
  Plus,
  Monitor,
  Check,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import { AGENTS as REAL_AGENTS } from "@/lib/agents";
import { CREATORS } from "./dashboard-data";
import MusicPlayer from "./MusicPlayer";
import RadioPanel from "./RadioPanel";

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

const STATUS_ORDER = ["working", "online", "idle"] as const;
const STATUS_LABELS: Record<string, string> = { working: "Working", online: "Online", idle: "Idle" };
const STATUS_COLORS: Record<string, string> = { working: "#00ff88", online: "#00f0ff", idle: "#666688" };

export default function DashboardWidgets({
  displayName,
  balance,
  claimed,
  visitors,
  onClaimAction,
  onOpenMusic,
  onOpenRadio,
}: {
  displayName: string;
  balance: number;
  claimed: boolean;
  visitors: number;
  onClaimAction: () => void;
  onOpenMusic?: () => void;
  onOpenRadio?: () => void;
}) {
  const { resolvedColors: T } = useTheme();

  const groupedAgents = STATUS_ORDER.map((status) => ({
    status,
    agents: AGENTS.filter((a) => a.status === status),
  })).filter((g) => g.agents.length > 0);

  return (
    <aside
      className="hidden xl:flex flex-col gap-6 w-80 shrink-0 p-4 border-l overflow-y-auto"
      style={{
        borderColor: `${T.borderColor}25`,
        backgroundColor: `${T.bgColor}60`,
      }}
    >
      {/* Profile Mini */}
      <GlassCard variant="flat" padding="sm" radius="lg">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0"
            style={{
              backgroundColor: `${T.accentColor}20`,
              border: `1px solid ${T.accentColor}40`,
              color: T.accentColor,
            }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>
              {displayName}
            </div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>
              Creator
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold shrink-0" style={{ color: T.accentColor }}>
            <Coins size={12} /> {balance.toLocaleString()}
          </div>
        </div>
      </GlassCard>

      {/* Music Player — clickable to open full view */}
      <div>
        <div className="text-xs font-bold uppercase tracking-widest mb-2 px-1" style={{ color: "#ff00a0cc" }}>
          Now Playing
        </div>
        <div
          className="cursor-pointer"
          onClick={onOpenMusic}
          title="Open full player"
        >
          <MusicPlayer mode="mini" />
        </div>
      </div>

      {/* Radio Panel mini */}
      <div>
        <div className="text-xs font-bold uppercase tracking-widest mb-2 px-1" style={{ color: "#10b981cc" }}>
          Live Radio
        </div>
        <div
          className="cursor-pointer"
          onClick={onOpenRadio}
          title="Open radio stations"
        >
          <RadioPanel mode="mini" />
        </div>
      </div>

      {/* Agent Cluster — grouped by status */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        header={
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: "#00f0ffcc" }}>
              <Activity size={12} /> Agents
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[9px]" style={{ color: T.textMuted }}>
                {AGENTS.filter((a) => a.status === "working" || a.status === "online").length} active
              </span>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {groupedAgents.map(({ status, agents }) => (
            <div key={status}>
              <div
                className="text-[9px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5"
                style={{ color: STATUS_COLORS[status] + "aa" }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: STATUS_COLORS[status],
                    boxShadow: status === "working" ? `0 0 4px ${STATUS_COLORS[status]}` : "none",
                  }}
                />
                {STATUS_LABELS[status]}
              </div>
              <div className="space-y-1">
                {agents.map((a) => (
                  <div
                    key={a.name}
                    className="flex items-center gap-3 group rounded-lg p-1.5 -mx-1.5 transition-colors hover:bg-white/5"
                  >
                    <span
                      className="relative w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: a.color }}
                    >
                      {status === "working" && (
                        <span
                          className="absolute inset-0 rounded-full animate-ping opacity-50"
                          style={{ backgroundColor: a.color }}
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>{a.name}</div>
                      <div className="text-[9px] truncate" style={{ color: T.textMuted }}>{a.task}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Daily Reward */}
      <GlassCard variant="flat" padding="sm" radius="lg" className={claimed ? "opacity-70" : ""}>
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
            <Coins size={22} style={{ color: claimed ? T.success : T.accentColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: T.textColor }}>
              {claimed ? "Reward Claimed!" : "Daily Reward"}
            </div>
            <div className="text-[10px]" style={{ color: T.textMuted }}>
              {claimed ? "Come back tomorrow" : "+50 LiTBit Coins"}
            </div>
            <button
              onClick={onClaimAction}
              disabled={claimed}
              className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: claimed ? `${T.success}20` : `${T.accentColor}25`,
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
      </GlassCard>

      {/* Top Creators */}
      <GlassCard
        variant="flat"
        padding="sm"
        radius="lg"
        header={
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest" style={{ color: "#8b5cf6cc" }}>
            <div className="flex items-center gap-2"><Users size={12} /> Creators</div>
            <span className="text-[9px] opacity-50">{CREATORS.length}</span>
          </div>
        }
      >
        <div className="space-y-3">
          {CREATORS.map((c) => (
            <div key={c.handle} className="flex items-center gap-3 group hover:opacity-80 transition-opacity">
              <Link href="/social" className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                  style={{ backgroundColor: `${c.color}20`, color: c.color, border: `1px solid ${c.color}40` }}
                >
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate" style={{ color: T.textColor }}>
                    {c.name} <span className="text-[9px] opacity-40">· {c.followers}</span>
                  </div>
                  <div className="text-[10px]" style={{ color: T.textMuted }}>{c.handle}</div>
                </div>
              </Link>
              <Link href="/social" className="p-1 transition-colors hover:opacity-80" style={{ color: c.color }} title="Follow on Social">
                <Plus size={13} />
              </Link>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Stats + System */}
      <div className="grid grid-cols-2 gap-3">
        <GlassCard variant="flat" padding="sm" radius="lg">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${T.accentColor}15` }}>
              <Monitor size={13} style={{ color: T.accentColor }} />
            </div>
            <div>
              <div className="text-base font-mono font-bold leading-none" style={{ color: T.headerColor }}>{visitors.toLocaleString()}</div>
              <div className="text-[9px]" style={{ color: T.textMuted }}>Visitors</div>
            </div>
          </div>
        </GlassCard>
        <GlassCard variant="flat" padding="sm" radius="lg">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${T.success}15` }}>
              <Activity size={13} style={{ color: T.success }} />
            </div>
            <div>
              <div className="text-base font-mono font-bold leading-none" style={{ color: T.headerColor }}>
                {AGENTS.filter((a) => a.status === "working").length}
              </div>
              <div className="text-[9px]" style={{ color: T.textMuted }}>Active</div>
            </div>
          </div>
        </GlassCard>
      </div>
    </aside>
  );
}
