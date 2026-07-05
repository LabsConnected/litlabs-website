"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { THEMES } from "@/lib/themes";
import {
  Activity,
  Bot,
  CircleDollarSign,
  Coins,
  HeartPulse,
  KeyRound,
  Layers,
  LineChart,
  Settings2,
  TerminalSquare,
  Wrench,
  Zap,
} from "lucide-react";

export type InspectorTab = "health" | "credits" | "logs" | "tools";

/**
 * StudioInspector — the right rail of the Command Center.
 *
 * Tabs: Health • Credits • Logs • Tools
 *
 * On mobile this same component is rendered inside a slide-up sheet
 * controlled by the parent. The "variant" prop switches between
 * inline-aside and sheet.
 */
export default function StudioInspector({
  variant = "aside",
  onClose,
  T,
}: {
  variant?: "aside" | "sheet";
  onClose?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [tab, setTab] = useState<InspectorTab>("health");

  const TABS: { id: InspectorTab; label: string; icon: typeof Activity }[] = [
    { id: "health", label: "Health", icon: HeartPulse },
    { id: "credits", label: "Credits", icon: CircleDollarSign },
    { id: "logs", label: "Logs", icon: TerminalSquare },
    { id: "tools", label: "Tools", icon: Wrench },
  ];

  const isSheet = variant === "sheet";

  return (
    <div
      className={
        isSheet
          ? "flex flex-col w-full max-h-[80vh]"
          : "hidden xl:flex flex-col w-[300px] shrink-0 border-l h-full"
      }
      style={
        isSheet
          ? {}
          : {
              backgroundColor: T.boxBg + "70",
              borderColor: T.borderColor + "20",
              backdropFilter: "blur(14px) saturate(180%)",
            }
      }
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-11 shrink-0"
        style={{ borderBottom: `1px solid ${T.borderColor}18` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 size={13} style={{ color: T.accentColor }} />
          <span
            className="text-[11px] font-black uppercase tracking-[0.18em] truncate"
            style={{ color: T.headerColor }}
          >
            Inspector
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Close inspector"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex items-stretch shrink-0"
        style={{ borderBottom: `1px solid ${T.borderColor}14` }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all"
              style={{
                color: active ? T.accentColor : T.textMuted,
                backgroundColor: active ? T.accentColor + "12" : "transparent",
                borderBottom: active
                  ? `2px solid ${T.accentColor}`
                  : "2px solid transparent",
              }}
            >
              <Icon size={11} />
              <span className="hidden md:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "health" && <HealthTab T={T} />}
        {tab === "credits" && <CreditsTab T={T} />}
        {tab === "logs" && <LogsTab T={T} />}
        {tab === "tools" && <ToolsTab T={T} />}
      </div>
    </div>
  );
}

/* ── Health tab ──────────────────────────────────────────────── */
function HealthTab({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const services = [
    { name: "OpenAI", status: "ok" as const, latency: "212ms" },
    { name: "Anthropic", status: "ok" as const, latency: "318ms" },
    { name: "Google Gemini", status: "ok" as const, latency: "189ms" },
    { name: "OpenRouter", status: "slow" as const, latency: "1.2s" },
    { name: "Local Ollama", status: "ok" as const, latency: "84ms" },
    { name: "Supabase", status: "ok" as const, latency: "62ms" },
  ];
  return (
    <div className="space-y-3">
      <Stat label="Uptime" value="99.9%" tone="ok" T={T} />
      <Stat label="Active agents" value="4 / 5" tone="ok" T={T} />
      <Stat label="P95 latency" value="284ms" tone="ok" T={T} />
      <Stat label="Failed jobs (24h)" value="2" tone="warn" T={T} />

      <div
        className="rounded-2xl border p-3"
        style={{
          backgroundColor: T.bgColor + "55",
          borderColor: T.borderColor + "20",
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em] mb-2"
          style={{ color: T.textMuted }}
        >
          Services
        </div>
        <div className="space-y-1.5">
          {services.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded-lg px-2 py-1.5"
              style={{ backgroundColor: T.boxBg + "60" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      s.status === "ok"
                        ? T.success
                        : s.status === "slow"
                          ? "#ffb347"
                          : "#ff3a3a",
                    boxShadow: `0 0 4px ${s.status === "ok" ? T.success : "#ffb347"}`,
                  }}
                />
                <span
                  className="text-[11px] font-bold truncate"
                  style={{ color: T.textColor }}
                >
                  {s.name}
                </span>
              </div>
              <span
                className="text-[10px] font-mono shrink-0"
                style={{ color: T.textMuted }}
              >
                {s.latency}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  T,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad";
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const color =
    tone === "ok" ? T.success : tone === "warn" ? "#ffb347" : "#ff3a3a";
  return (
    <div
      className="flex items-center justify-between rounded-2xl border px-3 py-2"
      style={{
        backgroundColor: T.bgColor + "55",
        borderColor: T.borderColor + "20",
      }}
    >
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: T.textMuted }}
      >
        {label}
      </span>
      <span className="text-[12px] font-black" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/* ── Credits tab ─────────────────────────────────────────────── */
function CreditsTab({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const { balance, isLoading } = useWallet();
  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border p-4 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${T.accentColor}20, ${T.linkColor}10)`,
          borderColor: T.accentColor + "40",
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ color: T.textMuted }}
        >
          LiTBit Coins
        </div>
        <div className="flex items-baseline gap-1.5 mt-1">
          <Coins size={16} style={{ color: T.accentColor }} />
          <span className="text-2xl font-black" style={{ color: T.textColor }}>
            {isLoading ? "—" : balance.toLocaleString()}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider opacity-60"
            style={{ color: T.textMuted }}
          >
            LBC
          </span>
        </div>
        <div className="mt-2 text-[10px]" style={{ color: T.textMuted }}>
          Refill in 6h 12m • Daily claim ready
        </div>
      </div>

      <Stat label="This hour" value="−42" tone="warn" T={T} />
      <Stat label="Today" value="−318" tone="warn" T={T} />
      <Stat label="This month" value="−4,820" tone="warn" T={T} />
      <Stat label="Quota left" value="12,180" tone="ok" T={T} />

      <div
        className="rounded-2xl border p-3"
        style={{
          backgroundColor: T.bgColor + "55",
          borderColor: T.borderColor + "20",
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em] mb-2"
          style={{ color: T.textMuted }}
        >
          Spend by model
        </div>
        {[
          { name: "Gemini 2.5 Flash", pct: 58, color: T.accentColor },
          { name: "GPT-4o", pct: 24, color: T.linkColor },
          { name: "Claude 3.5", pct: 12, color: "#ff6b35" },
          { name: "Local Ollama", pct: 6, color: T.success },
        ].map((m) => (
          <div key={m.name} className="mb-2 last:mb-0">
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-[11px] font-bold"
                style={{ color: T.textColor }}
              >
                {m.name}
              </span>
              <span
                className="text-[10px] font-mono"
                style={{ color: T.textMuted }}
              >
                {m.pct}%
              </span>
            </div>
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: T.borderColor + "30" }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${m.pct}%`, backgroundColor: m.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Logs tab ────────────────────────────────────────────────── */
function LogsTab({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const logs = [
    {
      time: "00:42:18",
      level: "info" as const,
      msg: "Director: plan v3 committed",
    },
    {
      time: "00:41:55",
      level: "info" as const,
      msg: "Code Champion: lint passed",
    },
    {
      time: "00:41:30",
      level: "warn" as const,
      msg: "OpenRouter: 1.2s latency spike",
    },
    {
      time: "00:40:11",
      level: "info" as const,
      msg: "Pipeline: image 1024×1024 OK",
    },
    {
      time: "00:39:02",
      level: "info" as const,
      msg: "Data Slayer: dashboard updated",
    },
    {
      time: "00:38:14",
      level: "bad" as const,
      msg: "GPT-4o: rate limited (1m backoff)",
    },
    {
      time: "00:37:00",
      level: "info" as const,
      msg: "Wallet: +250 LBC daily claim",
    },
  ];
  const color = (l: "info" | "warn" | "bad") =>
    l === "info" ? T.accentColor : l === "warn" ? "#ffb347" : "#ff3a3a";
  return (
    <div
      className="rounded-2xl border p-2 font-mono text-[10px] leading-relaxed"
      style={{
        backgroundColor: T.bgColor + "88",
        borderColor: T.borderColor + "20",
      }}
    >
      {logs.map((l, i) => (
        <div key={i} className="flex gap-2 py-0.5">
          <span className="opacity-40 shrink-0">{l.time}</span>
          <span
            className="uppercase font-bold shrink-0 w-7"
            style={{ color: color(l.level) }}
          >
            {l.level}
          </span>
          <span className="truncate" style={{ color: T.textColor }}>
            {l.msg}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Tools tab ───────────────────────────────────────────────── */
function ToolsTab({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const actions = [
    { icon: KeyRound, label: "Manage API keys", count: 4 },
    { icon: Layers, label: "Connect a model", count: 6 },
    { icon: Bot, label: "Browse agents", count: 12 },
    { icon: LineChart, label: "Open cost report", count: 1 },
    { icon: Zap, label: "Trigger fast run", count: 1 },
    { icon: Activity, label: "View deployment", count: 1 },
  ];
  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border p-2"
        style={{
          backgroundColor: T.bgColor + "55",
          borderColor: T.borderColor + "20",
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-1"
          style={{ color: T.textMuted }}
        >
          Quick actions
        </div>
        <div className="space-y-1">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                className="w-full flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
                style={{ color: T.textColor }}
              >
                <span className="flex items-center gap-2">
                  <Icon size={12} style={{ color: T.accentColor }} />
                  <span className="text-[11px] font-bold">{a.label}</span>
                </span>
                <span
                  className="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                  style={{
                    backgroundColor: T.accentColor + "20",
                    color: T.accentColor,
                  }}
                >
                  {a.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="rounded-2xl border p-3"
        style={{
          backgroundColor: T.bgColor + "55",
          borderColor: T.borderColor + "20",
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em] mb-2"
          style={{ color: T.textMuted }}
        >
          Theme
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {THEMES.slice(0, 8).map((theme) => (
            <div
              key={theme.id}
              className="rounded-lg p-2 flex flex-col items-center gap-1 cursor-pointer transition-all hover:scale-105"
              style={{ backgroundColor: T.boxBg + "80" }}
              title={theme.name}
            >
              <span
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: theme.accent }}
              />
              <span
                className="text-[8px] uppercase tracking-wider truncate w-full text-center"
                style={{ color: T.textMuted }}
              >
                {theme.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
