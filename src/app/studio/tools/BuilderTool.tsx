"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Code2,
  FolderKanban,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";

const START_ACTIONS = [
  {
    icon: ImageIcon,
    label: "Create an image",
    desc: "Generate art, ads, and product visuals",
    href: "/studio?tool=image",
    color: "#22d3ee",
  },
  {
    icon: Code2,
    label: "Build an app",
    desc: "Turn your idea into working code",
    href: "/code",
    color: "#fb923c",
  },
  {
    icon: Bot,
    label: "Launch an agent",
    desc: "Delegate research, coding, and repeat work",
    href: "/studio?tool=agents",
    color: "#c084fc",
  },
];

export default function BuilderTool() {
  const { resolvedColors: T } = useTheme();

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
          {START_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.label}
                href={action.href}
                className="group grid min-h-[82px] grid-cols-[44px_1fr_20px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/35 hover:bg-white/[.06] sm:min-h-44 sm:grid-cols-[1fr_20px] sm:content-between"
              >
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
              </Link>
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
