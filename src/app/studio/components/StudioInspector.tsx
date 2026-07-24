"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { THEMES } from "@/lib/themes";
import {
  Coins,
  Settings2,
  Image as ImageIcon,
  Film,
  Music,
  Hammer,
  MessageSquare,
  Layers,
  Clock,
  FolderOpen,
  Sliders,
  Bot,
  KeyRound,
  Activity,
  Zap,
  Code2,
  Camera,
  MonitorUp,
} from "lucide-react";
import type { StudioTool } from "./StudioSidebar";

/* ── Shared helpers ─────────────────────────────────────────────── */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-[9px] font-black uppercase tracking-[0.2em] mb-2 px-0.5"
        style={{ color: "rgba(255,255,255,0.55)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>
        {label}
      </span>
      <span
        className="text-[11px] font-bold"
        style={{ color: accent || "rgba(255,255,255,0.9)" }}
      >
        {value}
      </span>
    </div>
  );
}

function StatBar({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex justify-between mb-1">
        <span
          className="text-[10px]"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          {label}
        </span>
        <span
          className="text-[10px] font-mono"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          {pct}%
        </span>
      </div>
      <div
        className="h-1 rounded-full"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── Mode-specific inspector panels ─────────────────────────────── */

function ImageInspector({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="space-y-4">
      <Section title="Properties">
        <Row label="Dimensions" value="1024 × 1024" />
        <Row label="Seed" value="482910" />
        <Row label="Steps" value="28" />
        <Row label="CFG scale" value="7.5" />
        <Row label="Sampler" value="DPM++ 2M" />
      </Section>
      <Section title="Model">
        <Row label="Active" value="Flux 1.1 Pro" accent={T.accentColor} />
        <Row label="Provider" value="fal.ai" />
      </Section>
      <Section title="Generation history">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/3 rounded px-1 transition-colors"
          >
            <div
              className="w-8 h-8 rounded-md shrink-0 flex items-center justify-center text-lg"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <ImageIcon size={14} style={{ color: T.accentColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-[10px] font-bold truncate"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                Generation #{i}
              </div>
              <div
                className="text-[9px]"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                2 min ago · 1024×1024
              </div>
            </div>
          </div>
        ))}
      </Section>
      <Section title="Actions">
        <div className="grid grid-cols-2 gap-1.5">
          {["Upscale", "Edit", "Remove BG", "Animate", "Inpaint", "Expand"].map(
            (a) => (
              <button
                key={a}
                type="button"
                className="py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all hover:bg-white/8 text-left"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                {a}
              </button>
            ),
          )}
        </div>
      </Section>
    </div>
  );
}

function VideoInspector({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="space-y-4">
      <Section title="Properties">
        <Row label="Duration" value="6s" />
        <Row label="Resolution" value="1280 × 720" />
        <Row label="FPS" value="24" />
        <Row label="Motion" value="Medium" />
        <Row label="Camera" value="Dolly in" />
      </Section>
      <Section title="Model">
        <Row label="Active" value="Kling 1.6 Pro" accent={T.accentColor} />
        <Row label="Provider" value="fal.ai" />
      </Section>
      <Section title="Scenes">
        {["Intro — 0:00", "Main — 0:02", "Outro — 0:05"].map((s) => (
          <div
            key={s}
            className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/3 rounded px-1 transition-colors"
          >
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: T.accentColor }}
            />
            <span
              className="text-[10px] font-bold"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              {s}
            </span>
          </div>
        ))}
      </Section>
      <Section title="Tracks">
        <Row label="Audio" value="No audio" />
        <Row label="Captions" value="Off" />
      </Section>
      <Section title="Export">
        <Row label="Format" value="MP4 H.264" />
        <Row label="Quality" value="High" />
      </Section>
    </div>
  );
}

function AudioInspector({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="space-y-4">
      <Section title="Properties">
        <Row label="Duration" value="3:24" />
        <Row label="Genre" value="Cinematic" />
        <Row label="Tempo" value="128 BPM" />
        <Row label="Key" value="A minor" />
        <Row label="Mode" value="Music" />
      </Section>
      <Section title="Model">
        <Row label="Active" value="MiniMax Music" accent={T.accentColor} />
      </Section>
      <Section title="Stems">
        {["Melody", "Bass", "Drums", "Atmosphere"].map((s) => (
          <div
            key={s}
            className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
          >
            <span
              className="text-[10px] font-bold"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              {s}
            </span>
            <div
              className="w-8 h-1.5 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: "75%", background: T.accentColor }}
              />
            </div>
          </div>
        ))}
      </Section>
      <Section title="Export">
        <Row label="Format" value="WAV 44.1k" />
        <Row label="Stems" value="Separate" />
      </Section>
    </div>
  );
}

function ChatInspector({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="space-y-4">
      <Section title="Conversation">
        <Row label="Messages" value="24" />
        <Row label="Tokens used" value="12,480" />
        <Row label="Model" value="Gemini 2.5 Flash" accent={T.accentColor} />
        <Row label="Context window" value="1M" />
      </Section>
      <Section title="Agents active">
        {["Copilot", "Forge", "Research Beast"].map((a) => (
          <div
            key={a}
            className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: "#34d399" }}
            />
            <span
              className="text-[10px] font-bold"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              {a}
            </span>
          </div>
        ))}
      </Section>
      <Section title="Memory">
        <Row label="Project context" value="Active" accent="#34d399" />
        <Row label="Past missions" value="8 loaded" />
        <Row label="Files indexed" value="34" />
      </Section>
    </div>
  );
}

function BuilderInspector({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="space-y-4">
      <Section title="Project">
        <Row label="Files" value="142" />
        <Row label="Bundle size" value="284 KB" />
        <Row label="Framework" value="Next.js 16" />
        <Row label="Branch" value="feature/landing" accent={T.accentColor} />
      </Section>
      <Section title="Environment">
        <Row label="Node" value="22.2.0" />
        <Row label="TypeScript" value="5.8.3" />
        <Row label="Status" value="Running" accent="#34d399" />
      </Section>
      <Section title="Deploy">
        <Row label="Target" value="Vercel" />
        <Row label="Last deploy" value="2h ago" />
        <Row label="Preview" value="Live" accent="#34d399" />
      </Section>
    </div>
  );
}

/* ── Credits / System panel (moved from top-level) ────────────── */
function SystemPanel({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const { balance, isLoading } = useWallet();
  return (
    <div className="space-y-4">
      <Section title="LiTBit credits">
        <div
          className="rounded-xl p-3 mb-2"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}18, rgba(255,255,255,0.03))`,
            border: `1px solid ${T.accentColor}25`,
          }}
        >
          <div className="flex items-baseline gap-1.5">
            <Coins size={14} style={{ color: T.accentColor }} />
            <span
              className="text-xl font-black"
              style={{ color: "rgba(255,255,255,0.9)" }}
            >
              {isLoading ? "—" : balance.toLocaleString()}
            </span>
            <span
              className="text-[10px] font-bold"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              LBC
            </span>
          </div>
          <div
            className="text-[10px] mt-1"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            Daily claim ready · Refill in 6h
          </div>
        </div>
        <Row label="Used today" value="−318" />
        <Row label="Quota left" value="12,180" accent="#34d399" />
      </Section>
      <Section title="Spend by model">
        <StatBar label="Gemini 2.5 Flash" pct={58} color={T.accentColor} />
        <StatBar label="GPT-4o" pct={24} color={T.linkColor} />
        <StatBar label="Claude 3.5" pct={12} color="#f97316" />
        <StatBar label="Ollama (local)" pct={6} color="#34d399" />
      </Section>
      <Section title="System">
        {[
          { name: "OpenRouter", ok: true, latency: "284ms" },
          { name: "Supabase", ok: true, latency: "62ms" },
          { name: "fal.ai", ok: true, latency: "140ms" },
        ].map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: s.ok ? "#34d399" : "#f87171" }}
              />
              <span
                className="text-[11px] font-bold"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                {s.name}
              </span>
            </div>
            <span
              className="text-[10px] font-mono"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              {s.latency}
            </span>
          </div>
        ))}
      </Section>
      <Section title="Quick actions">
        {[
          { icon: KeyRound, label: "API keys" },
          { icon: Bot, label: "Browse agents" },
          { icon: Activity, label: "Deployments" },
          { icon: Zap, label: "Fast run" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            <Icon size={11} style={{ color: T.accentColor }} />
            <span className="text-[11px] font-bold">{label}</span>
          </button>
        ))}
      </Section>
      <Section title="Theme">
        <div className="grid grid-cols-4 gap-1.5">
          {THEMES.slice(0, 8).map((theme) => (
            <div
              key={theme.id}
              className="rounded-lg p-2 flex flex-col items-center gap-1 cursor-pointer transition-all hover:scale-105"
              style={{ background: "rgba(255,255,255,0.04)" }}
              title={theme.name}
            >
              <span
                className="w-4 h-4 rounded-full"
                style={{ background: theme.accent }}
              />
              <span
                className="text-[8px] uppercase tracking-wider truncate w-full text-center"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                {theme.name}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ── Config per mode ─────────────────────────────────────────────── */
type InspectorMode = StudioTool | "default";
type TabDef = { id: string; label: string; icon: typeof Layers };

function getTabsForMode(mode: InspectorMode): TabDef[] {
  const base: TabDef[] = [
    { id: "context", label: "Context", icon: Layers },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "history", label: "History", icon: Clock },
    { id: "system", label: "System", icon: Sliders },
  ];

  switch (mode) {
    case "home":
      return [
        { id: "context", label: "Home", icon: Bot },
        ...base.slice(1),
      ];
    case "chat":
      return [
        { id: "context", label: "Chat", icon: MessageSquare },
        ...base.slice(1),
      ];
    case "image":
      return [
        { id: "context", label: "Image", icon: ImageIcon },
        ...base.slice(1),
      ];
    case "video":
      return [{ id: "context", label: "Video", icon: Film }, ...base.slice(1)];
    case "audio":
      return [{ id: "context", label: "Audio", icon: Music }, ...base.slice(1)];
    case "build":
      return [
        { id: "context", label: "Build", icon: Hammer },
        ...base.slice(1),
      ];
    case "code":
      return [
        { id: "context", label: "Code", icon: Code2 },
        ...base.slice(1),
      ];
    case "agents":
      return [
        { id: "context", label: "Agents", icon: Bot },
        ...base.slice(1),
      ];
    case "assets":
      return [
        { id: "context", label: "Assets", icon: FolderOpen },
        ...base.slice(1),
      ];
    case "plugins":
      return [
        { id: "context", label: "Plugins", icon: Sliders },
        ...base.slice(1),
      ];
    case "camera":
      return [
        { id: "context", label: "Camera", icon: Camera },
        ...base.slice(1),
      ];
    case "screen":
      return [
        { id: "context", label: "Screen", icon: MonitorUp },
        ...base.slice(1),
      ];
    default:
      return base;
  }
}

function renderContext(
  mode: InspectorMode,
  T: ReturnType<typeof useTheme>["resolvedColors"],
) {
  switch (mode) {
    case "home":
      return <ChatInspector T={T} />;
    case "chat":
      return <ChatInspector T={T} />;
    case "image":
      return <ImageInspector T={T} />;
    case "video":
      return <VideoInspector T={T} />;
    case "audio":
      return <AudioInspector T={T} />;
    case "build":
      return <BuilderInspector T={T} />;
    case "code":
      return <BuilderInspector T={T} />;
    case "agents":
      return <BuilderInspector T={T} />;
    case "assets":
      return <BuilderInspector T={T} />;
    default:
      return (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
          <Layers size={20} style={{ color: "rgba(255,255,255,0.15)" }} />
          <p
            className="text-[11px]"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            Select a mode to see context
          </p>
        </div>
      );
  }
}

/* ── Export ─────────────────────────────────────────────────────── */
export default function StudioInspector({
  variant = "aside",
  onClose,
  T,
  activeTool,
}: {
  variant?: "aside" | "sheet";
  onClose?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  activeTool?: StudioTool;
}) {
  const mode: InspectorMode = activeTool ?? "default";
  const tabs = getTabsForMode(mode);
  const [tab, setTab] = useState<string>("context");
  const isSheet = variant === "sheet";

  return (
    <div
      className={
        isSheet
          ? "flex flex-col w-full max-h-[80vh]"
          : "hidden xl:flex flex-col w-[280px] shrink-0 border-l h-full"
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
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            Inspector
          </span>
          {activeTool && (
            <span
              className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: T.accentColor + "20", color: T.accentColor }}
            >
              {activeTool}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.4)" }}
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
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all"
              style={{
                color: active ? T.accentColor : "rgba(255,255,255,0.6)",
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {tab === "context" && renderContext(mode, T)}
        {tab === "files" && (
          <Section title="Project files">
            {[
              "src/app/page.tsx",
              "src/components/Hero.tsx",
              "src/styles/global.css",
              "public/og.png",
            ].map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/3 rounded px-1 transition-colors"
              >
                <FolderOpen size={11} style={{ color: T.accentColor }} />
                <span
                  className="text-[10px] font-mono truncate"
                  style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  {f}
                </span>
              </div>
            ))}
          </Section>
        )}
        {tab === "history" && (
          <Section title="Version history">
            {["v3 — 2 min ago", "v2 — 18 min ago", "v1 — 1h ago"].map((v) => (
              <div
                key={v}
                className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/3 rounded px-1 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Clock size={10} style={{ color: T.accentColor }} />
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: "rgba(255,255,255,0.7)" }}
                  >
                    {v}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-[9px] font-bold hover:underline"
                  style={{ color: T.accentColor }}
                >
                  Restore
                </button>
              </div>
            ))}
          </Section>
        )}
        {tab === "system" && <SystemPanel T={T} />}
      </div>
    </div>
  );
}
