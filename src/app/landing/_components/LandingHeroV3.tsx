"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────
 * LandingHeroV3 — Pass 1
 *
 * Messaging hierarchy:
 *   Eyebrow:   The AI Creative Operating System
 *   Primary:   Bring the idea.
 *   Secondary: LiTT helps you build the rest.
 *   Support:   One intelligent workspace for planning, coding, creating,
 *              testing, remembering, and shipping real projects.
 *
 * Composition:
 *   - LiTT character above fold (left on desktop, centered on mobile)
 *   - Real Studio screenshot + micro-panels (Mission / Runtime / Terminal)
 *   - Nearly-black base with purple ambient bloom + LiTT-green accent
 *   - Restrained animation: breathing glow, floating, state pulse
 *   - Respects prefers-reduced-motion
 * ──────────────────────────────────────────────────────────────────── */

const MISSION_STEPS = [
  { state: "done", label: "Understanding project" },
  { state: "done", label: "Reading workspace" },
  { state: "done", label: "Planning" },
  { state: "active", label: "Building" },
  { state: "pending", label: "Testing" },
  { state: "pending", label: "Ready to ship" },
] as const;

const RUNTIME_SERVICES = [
  { label: "FILES", status: "READY", color: "text-emerald-400" },
  { label: "TERMINAL", status: "READY", color: "text-emerald-400" },
  { label: "MEMORY", status: "ACTIVE", color: "text-cyan-400" },
  { label: "AGENT", status: "WORKING", color: "text-orange-300" },
] as const;

export function LandingHeroV3() {
  return (
    <section className="relative z-10 px-4 pt-16 pb-12 md:pt-24 md:pb-16 lg:pt-28">
      {/* ── Ambient depth layer (hero-local) ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Purple ambient bloom — upper left */}
        <div className="absolute -top-20 -left-20 h-[500px] w-[500px] rounded-full bg-violet-600/12 blur-[140px]" />
        {/* LiTT-green accent — lower right */}
        <div className="absolute -bottom-32 -right-20 h-[400px] w-[400px] rounded-full bg-emerald-500/8 blur-[130px]" />
        {/* Subtle workspace grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(168,85,247,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 35%, black 20%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 70% 60% at 50% 35%, black 20%, transparent 75%)",
          }}
        />
      </div>

      {/* ── Hero grid: text + product proof ── */}
      <div className="relative mx-auto max-w-7xl">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          {/* ══════════ LEFT: Messaging + CTAs ══════════ */}
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            {/* Eyebrow */}
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/8 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
              </span>
              The AI Creative Operating System
            </div>

            {/* Primary headline */}
            <h1 className="text-5xl font-black leading-[1.02] tracking-tight text-white md:text-6xl lg:text-7xl">
              Bring the idea.
            </h1>

            {/* Secondary headline */}
            <h2
              className="mt-1 text-4xl font-black leading-[1.05] tracking-tight md:text-5xl lg:text-6xl"
              style={{
                background: "linear-gradient(110deg, #a855f7 0%, #c084fc 50%, #34d399 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              LiTT helps you build the rest.
            </h2>

            {/* Support copy */}
            <p className="mt-5 max-w-xl text-base leading-relaxed text-neutral-400 md:text-lg">
              One intelligent workspace for{" "}
              <span className="font-semibold text-neutral-200">planning</span>,{" "}
              <span className="font-semibold text-neutral-200">coding</span>,{" "}
              <span className="font-semibold text-neutral-200">creating</span>,{" "}
              <span className="font-semibold text-neutral-200">testing</span>,{" "}
              <span className="font-semibold text-neutral-200">remembering</span>, and{" "}
              <span className="font-semibold text-neutral-200">shipping</span> real projects.
            </p>

            {/* CTAs */}
            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
              <Link
                href="/sign-up"
                className="group inline-flex items-center gap-2.5 rounded-2xl bg-white px-8 py-3.5 text-sm font-black text-black shadow-[0_0_40px_rgba(168,85,247,0.25)] transition hover:shadow-[0_0_60px_rgba(168,85,247,0.4)]"
              >
                Start Building Free
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:border-violet-400/30 hover:bg-white/8"
              >
                <Play size={13} className="text-violet-300" />
                Watch LiTT Work
              </Link>
            </div>

            {/* Trust line */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-neutral-500 lg:justify-start">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-emerald-400" />
                Free during beta
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-cyan-400" />
                No credit card required
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-violet-400" />
                Connect GitHub in seconds
              </span>
            </div>
          </div>

          {/* ══════════ RIGHT: LiTT character + product proof ══════════ */}
          <div className="relative flex flex-col items-center">
            {/* LiTT character with breathing glow */}
            <div className="relative flex items-center justify-center">
              {/* Breathing glow halo */}
              <div
                className="pointer-events-none absolute inset-0 rounded-full blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle at 50% 45%, rgba(168,85,247,0.35) 0%, rgba(52,211,153,0.12) 40%, transparent 70%)",
                  animation: "litt-breath 4s ease-in-out infinite",
                }}
              />
              {/* LiTT character */}
              <div
                className="relative z-10"
                style={{ animation: "litt-float 6s ease-in-out infinite" }}
              >
                <Image
                  src="/brand/litt-mascot-hero.png"
                  alt="LiTT — the AI creative operating system character"
                  width={320}
                  height={400}
                  priority
                  className="h-auto w-[240px] md:w-[280px] lg:w-[300px] drop-shadow-[0_8px_40px_rgba(168,85,247,0.3)]"
                />
              </div>
            </div>

            {/* Product proof: layered micro-panels */}
            <div className="relative z-20 mt-[-30px] w-full max-w-md lg:mt-[-40px]">
              {/* Real Studio screenshot — primary proof */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a14] shadow-[0_8px_60px_rgba(0,0,0,0.6)]">
                {/* Window chrome */}
                <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d18] px-4 py-2.5">
                  <div className="flex gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                  </div>
                  <span className="ml-2 text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-500">
                    studio.litlabs.net
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:hidden" />
                    LIVE
                  </span>
                </div>

                {/* Real Studio screenshot */}
                <div className="relative aspect-[1798/875] w-full overflow-hidden">
                  <Image
                    src="/studio/creative-engine-hero.png"
                    alt="LiTT Studio — the real creative engine interface"
                    fill
                    sizes="(max-width: 1024px) 100vw, 480px"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a14] via-transparent to-transparent" />
                </div>
              </div>

              {/* Micro-panels: Mission + Runtime (below screenshot) */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                {/* Mission panel */}
                <div className="rounded-xl border border-white/8 bg-[#0a0a14]/90 p-3.5 backdrop-blur-sm">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400 motion-reduce:hidden" />
                    <span className="text-[8px] font-black uppercase tracking-[0.18em] text-neutral-500">
                      LiTT Mission
                    </span>
                  </div>
                  <div className="mb-2 text-[10px] font-bold text-neutral-300">
                    Build the launch experience.
                  </div>
                  <div className="space-y-1">
                    {MISSION_STEPS.map((step) => (
                      <div key={step.label} className="flex items-center gap-1.5 text-[9px]">
                        {step.state === "done" && (
                          <span className="text-emerald-400">✓</span>
                        )}
                        {step.state === "active" && (
                          <span className="text-orange-400 motion-reduce:hidden">●</span>
                        )}
                        {step.state === "pending" && (
                          <span className="text-neutral-700">○</span>
                        )}
                        <span
                          className={
                            step.state === "done"
                              ? "text-neutral-500"
                              : step.state === "active"
                              ? "font-semibold text-orange-300"
                              : "text-neutral-700"
                          }
                        >
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Runtime panel */}
                <div className="rounded-xl border border-white/8 bg-[#0a0a14]/90 p-3.5 backdrop-blur-sm">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:hidden" />
                    <span className="text-[8px] font-black uppercase tracking-[0.18em] text-neutral-500">
                      Runtime
                    </span>
                  </div>
                  <div className="mb-1.5 text-[10px] font-bold text-emerald-400">ONLINE</div>
                  <div className="space-y-1.5">
                    {RUNTIME_SERVICES.map((svc) => (
                      <div
                        key={svc.label}
                        className="flex items-center justify-between text-[9px] font-mono"
                      >
                        <span className="font-bold text-neutral-400">{svc.label}</span>
                        <span className={svc.color}>{svc.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Terminal strip */}
              <div className="mt-3 rounded-xl border border-white/8 bg-[#06060e]/95 p-3 font-mono backdrop-blur-sm">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-[8px] font-black uppercase tracking-[0.18em] text-neutral-600">
                    Terminal
                  </span>
                  <span className="ml-auto text-[8px] text-neutral-700">bash</span>
                </div>
                <div className="space-y-0.5 text-[9px] leading-relaxed">
                  <div className="text-emerald-400">
                    <span className="text-neutral-600">$</span> litt run git status --short
                  </div>
                  <div className="text-neutral-500">
                    <span className="text-cyan-400">M</span> src/app/landing/page.tsx
                  </div>
                  <div className="text-neutral-500">
                    <span className="text-emerald-400">✓</span> run_1786691 · success · 415ms
                  </div>
                  <div className="text-violet-400">
                    <span className="text-neutral-600">$</span>{" "}
                    <span className="motion-reduce:animate-none animate-pulse">▋</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero-local animations ── */}
      <style>{`
        @keyframes litt-breath {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.08); }
        }
        @keyframes litt-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .litt-breath, .litt-float { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
