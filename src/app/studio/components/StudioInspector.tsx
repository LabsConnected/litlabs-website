"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { THEMES } from "@/lib/themes";
import {
  Activity,
  Bot,
  Camera,
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
  Eye,
  EyeOff,
  Radio,
  Sparkles,
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
  cameraStream,
  screenStream,
  cameraError,
  onCameraToggle,
  onScreenToggle,
  T,
}: {
  variant?: "aside" | "sheet";
  onClose?: () => void;
  cameraStream?: MediaStream | null;
  screenStream?: MediaStream | null;
  cameraError?: string | null;
  onCameraToggle?: () => void;
  onScreenToggle?: () => void;
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

      <LiTTCompanion
        cameraStream={cameraStream ?? null}
        screenStream={screenStream ?? null}
        cameraError={cameraError ?? null}
        onCameraToggle={onCameraToggle}
        onScreenToggle={onScreenToggle}
        T={T}
      />

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

function LiTTCompanion({
  cameraStream,
  screenStream,
  cameraError,
  onCameraToggle,
  onScreenToggle,
  T,
}: {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  cameraError: string | null;
  onCameraToggle?: () => void;
  onScreenToggle?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phrase, setPhrase] = useState(0);
  const [visionNote, setVisionNote] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [hour] = useState(() => new Date().getHours());
  const visualStream = screenStream ?? cameraStream;
  const welcome = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const phrases = screenStream
    ? [
        "Screen vision is active. Show me what needs fixing.",
        "I’m watching the workspace, not recording it.",
        "I can compare this view with the next change.",
      ]
    : cameraStream
    ? [
        "Vision is online. I can follow the session with you.",
        "I’m here, Creator. Show me what we’re improving.",
        "Workspace context is active. Tell me where to focus.",
      ]
    : [
        `${welcome}, Creator. What are we building?`,
        "One terminal. Your tools are ready below.",
        "Say it, type it, or turn on vision. I’m with you.",
      ];

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = visualStream;
  }, [visualStream]);

  useEffect(() => {
    const timer = window.setInterval(() => setPhrase((current) => current + 1), 7000);
    return () => window.clearInterval(timer);
  }, []);

  const inspectView = async () => {
    const video = videoRef.current;
    if (!video || !visualStream || video.videoWidth === 0) return;
    setAnalyzing(true);
    try {
      const canvas = document.createElement("canvas");
      const maxWidth = 960;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const encoded = canvas.toDataURL("image/jpeg", 0.72).split(",")[1];
      const response = await fetch("/api/media/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBytes: encoded,
          mimeType: "image/jpeg",
          prompt: screenStream
            ? "Inspect this shared screen. Identify the visible interface issue or current work state and suggest the single best next action. Be concise."
            : "A user explicitly shared this camera frame with LiTT. Respond naturally and helpfully without inferring sensitive personal traits. If no work object is visible, simply confirm presence and ask what to inspect.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Vision analysis failed");
      setVisionNote(data.text);
    } catch (error) {
      setVisionNote(error instanceof Error ? error.message : "Vision analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <section className="shrink-0 p-2.5" style={{ borderBottom: `1px solid ${T.borderColor}18` }}>
      <div
        className="relative overflow-hidden rounded-2xl border p-2.5"
        style={{
          background: `radial-gradient(circle at 24% 30%, ${T.accentColor}25, transparent 30%), linear-gradient(145deg, ${T.bgColor}, ${T.boxBg})`,
          borderColor: `${T.accentColor}38`,
          boxShadow: `inset 0 0 28px ${T.accentColor}08, 0 0 22px ${T.accentColor}08`,
        }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent 0 5px, ${T.accentColor} 6px)` }} />
        <div className="relative flex items-center gap-2.5">
          <div className="relative grid h-14 w-14 shrink-0 place-items-center">
            <span className="absolute inset-1 animate-pulse rounded-full border" style={{ borderColor: `${T.accentColor}80`, boxShadow: `0 0 22px ${T.accentColor}55, inset 0 0 18px ${T.linkColor}35` }} />
            <span className="absolute inset-0 animate-[spin_9s_linear_infinite] rounded-full border border-dashed" style={{ borderColor: `${T.linkColor}55` }} />
            <span className="absolute h-10 w-10 rounded-full blur-md" style={{ backgroundColor: `${T.accentColor}35` }} />
            <Bot size={23} className="relative z-10" style={{ color: T.accentColor, filter: `drop-shadow(0 0 7px ${T.accentColor})` }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Sparkles size={10} style={{ color: T.accentColor }} />
              <b className="text-[10px] uppercase tracking-[.18em]" style={{ color: T.headerColor }}>LiTT-Code</b>
              <span className="ml-auto flex items-center gap-1 text-[8px] font-bold" style={{ color: T.success }}><Radio size={8} /> LIVE</span>
            </div>
            <p className="mt-1 min-h-8 text-[9px] leading-relaxed transition-opacity" style={{ color: T.textMuted }}>
              {phrases[phrase % phrases.length]}
            </p>
          </div>
        </div>

        <button
          onClick={screenStream ? onScreenToggle : onCameraToggle}
          className="relative mt-2 block w-full overflow-hidden rounded-xl border text-left"
          style={{ borderColor: cameraStream ? `${T.success}55` : `${T.borderColor}25`, backgroundColor: `${T.bgColor}bb` }}
        >
          {visualStream ? (
            <div className="relative aspect-video">
              <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${screenStream ? "" : "[transform:scaleX(-1)]"}`} />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
                <span className="flex items-center gap-1 text-[8px] font-black text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> {screenStream ? "SCREEN LIVE" : "VISION LIVE"}</span>
                <span className="text-[8px] text-emerald-300">{screenStream ? "Workspace context" : "LiTT can see"}</span>
              </div>
              <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/65 p-1 text-white"><EyeOff size={11} /></span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ backgroundColor: `${T.accentColor}15`, color: T.accentColor }}><Camera size={13} /></span>
              <span className="min-w-0 flex-1"><b className="block text-[9px]" style={{ color: T.textColor }}>Turn on LiTT Vision</b><span className="block truncate text-[8px]" style={{ color: cameraError ? "#fb7185" : T.textMuted }}>{cameraError || "Camera stays compact in this rail"}</span></span>
              <Eye size={12} style={{ color: T.textMuted }} />
            </div>
          )}
        </button>
        {visualStream && (
          <div className="relative mt-1.5 rounded-xl border p-2" style={{ borderColor: `${T.borderColor}20`, backgroundColor: `${T.bgColor}aa` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[8px] font-bold uppercase tracking-[.16em]" style={{ color: T.textMuted }}>Explicit vision check</span>
              <button
                onClick={() => void inspectView()}
                disabled={analyzing}
                className="rounded-lg px-2 py-1 text-[8px] font-black disabled:opacity-50"
                style={{ backgroundColor: `${T.accentColor}20`, color: T.accentColor }}
              >
                {analyzing ? "Inspecting…" : "Ask LiTT what it sees"}
              </button>
            </div>
            {visionNote && <p className="mt-1.5 text-[9px] leading-relaxed" style={{ color: T.textColor }}>{visionNote}</p>}
          </div>
        )}
      </div>
    </section>
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
