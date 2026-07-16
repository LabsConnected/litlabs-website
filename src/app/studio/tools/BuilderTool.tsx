"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Code2,
  FolderKanban,
  FolderOpen,
  Image as ImageIcon,
  Sparkles,
  Film,
  Music,
  Terminal,
  Layers,
  Zap,
  Rocket,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";
import type { StudioTool } from "../components/LITTTerminalShell";

type ToolAction = {
  icon: typeof ImageIcon;
  label: string;
  desc: string;
  tool?: StudioTool;
  href?: string;
  color: string;
};

const PRIMARY_ACTIONS: ToolAction[] = [
  {
    icon: ImageIcon,
    label: "Create an image",
    desc: "Generate art, ads, and product visuals",
    tool: "image",
    color: "#22d3ee",
  },
  {
    icon: Code2,
    label: "Build an app",
    desc: "Turn your idea into working code",
    tool: "canvas",
    color: "#fb923c",
  },
  {
    icon: Bot,
    label: "Launch an agent",
    desc: "Delegate research, coding, and repeat work",
    tool: "agents",
    color: "#c084fc",
  },
];

const MORE_ACTIONS: ToolAction[] = [
  { icon: Film, label: "Video", desc: "Generate video clips", tool: "video", color: "#f43f5e" },
  { icon: Music, label: "Audio", desc: "Generate music & voice", tool: "audio", color: "#a78bfa" },
  { icon: Terminal, label: "Terminal", desc: "Real PTY or local shell", tool: "terminal", color: "#22c55e" },
  { icon: Layers, label: "Pipeline", desc: "Visual workflow builder", tool: "pipeline", color: "#f59e0b" },
  { icon: Zap, label: "Loops", desc: "Autonomous agent loops", tool: "loops", color: "#06b6d4" },
  { icon: Rocket, label: "Space", desc: "3D skybox generation", tool: "space", color: "#ff6b35" },
  { icon: FolderOpen, label: "Gallery", desc: "Browse your assets", tool: "gallery", color: "#8b5cf6" },
  { icon: Terminal, label: "CLI Bridge", desc: "Connect external terminals", tool: "clibridge", color: "#10b981" },
];

export default function BuilderTool({
  onToolSelectAction,
}: {
  onToolSelectAction?: (tool: StudioTool) => void;
}) {
  const { resolvedColors: T } = useTheme();

  function handleAction(action: ToolAction) {
    if (action.tool && onToolSelectAction) {
      onToolSelectAction(action.tool);
    }
  }

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 pb-10 pt-5 sm:px-6 sm:pt-10">
      <section className="mx-auto max-w-4xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 shadow-[0_0_28px_rgba(34,211,238,.18)]">
          <Sparkles size={22} aria-hidden="true" />
        </div>
        <p className="mt-4 text-center text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">
          LiTT is ready
        </p>
        <h1 className="mx-auto mt-2 max-w-2xl text-center text-[30px] font-black leading-[1.05] tracking-[-.045em] text-white sm:text-5xl">
          What do you want to create?
        </h1>
        <p className="mx-auto mt-3 max-w-md text-center text-sm leading-relaxed" style={{ color: T.textMuted }}>
          Start with an idea. Your AI crew will help you make it real.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {PRIMARY_ACTIONS.map((action) => {
            const Icon = action.icon;
            const inner = (
              <>
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl sm:col-span-2"
                  style={{ color: action.color, backgroundColor: `${action.color}18` }}
                >
                  <Icon size={21} aria-hidden="true" />
                </span>
                <span>
                  <b className="block text-sm text-white">{action.label}</b>
                  <small className="mt-1 block text-[11px] leading-snug" style={{ color: T.textMuted }}>
                    {action.desc}
                  </small>
                </span>
                <ArrowRight size={17} aria-hidden="true" style={{ color: action.color }} />
              </>
            );
            const className =
              "group grid min-h-[82px] grid-cols-[44px_1fr_20px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/35 hover:bg-white/[.06] sm:min-h-44 sm:grid-cols-[1fr_20px] sm:content-between";
            if (action.href) {
              return (
                <Link key={action.label} href={action.href} className={className}>
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={action.label}
                onClick={() => handleAction(action)}
                className={className}
              >
                {inner}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {MORE_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => handleAction(action)}
                className="group flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] p-3 text-center transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[.05]"
              >
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg"
                  style={{ color: action.color, backgroundColor: `${action.color}15` }}
                >
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="text-xs font-bold text-white">{action.label}</span>
                <span className="text-[10px] leading-tight" style={{ color: T.textMuted }}>
                  {action.desc}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
              <span>Recent project</span>
              <Link href="/projects" className="normal-case tracking-normal text-cyan-300">View all</Link>
            </div>
            <Link href="/projects" className="mt-3 grid grid-cols-[40px_1fr_18px] items-center gap-3 rounded-xl p-1 text-white">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 text-[10px] font-black text-black">LL</span>
              <span><b className="block text-sm">LiTTree Lab Studios</b><small className="mt-1 block text-[10px]" style={{ color: T.textMuted }}>Updated today</small></span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
              <span>Your AI crew</span><span className="text-emerald-300">Online</span>
            </div>
            <div className="mt-3 grid grid-cols-[40px_1fr_10px] items-center gap-3 p-1">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-linear-to-br from-violet-600 to-cyan-400 text-xs font-black text-white">Li</span>
              <span><b className="block text-sm text-white">LiTT Director</b><small className="mt-1 block text-[10px]" style={{ color: T.textMuted }}>Ready to help</small></span>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" aria-label="Online" />
            </div>
          </section>
        </div>

        <Link href="/code" className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/[.06] text-xs font-black text-cyan-200">
          <FolderKanban size={15} aria-hidden="true" /> Open full workspace
        </Link>

        <details className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-3">
          <summary className="cursor-pointer list-none text-center text-[10px] font-black uppercase tracking-widest" style={{ color: T.textMuted }}>
            System status
          </summary>
          <div className="mt-3"><SystemTopologyPanel compact /></div>
        </details>
      </section>
    </div>
  );
}
