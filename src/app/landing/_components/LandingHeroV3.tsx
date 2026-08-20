"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Play, Folder, FileCode, ChevronRight, Circle, CheckCircle2, Loader2, Terminal as TerminalIcon } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────
 * LandingHeroV3 — Pass 2: Scaled composition, LiTT as operator
 *
 * Messaging hierarchy:
 *   Eyebrow:   The AI Creative Operating System
 *   Primary:   Bring the idea.
 *   Secondary: LiTT helps you build the rest.
 *   Support:   One intelligent workspace for planning, coding, creating,
 *              testing, remembering, and shipping real projects.
 *
 * Composition:
 *   - Studio product frame behind LiTT (z-10) with file tree + canvas
 *   - LiTT character in front, overlapping Studio (z-20)
 *   - Mission / Runtime / Terminal panels below — readable, not microscopic
 *   - Container: max-w-[1500px], small gutters, hero fills viewport
 *   - Headline: clamp(48px, 5vw, 94px) — dominant
 *   - CTAs: 56px high, 16px text — premium
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

const FILE_TREE = [
  { name: "src/", type: "folder", depth: 0 },
  { name: "components/", type: "folder", depth: 1 },
  { name: "Hero.tsx", type: "file", depth: 2, active: true },
  { name: "Studio.tsx", type: "file", depth: 2 },
  { name: "app/", type: "folder", depth: 1 },
  { name: "dashboard.tsx", type: "file", depth: 2 },
  { name: "assets/", type: "folder", depth: 1 },
  { name: "litt-mascot.png", type: "file", depth: 2 },
] as const;

export function LandingHeroV3() {
  return (
    <section className="relative z-10 px-6 pt-6 pb-10 md:px-10 md:pt-10 md:pb-14 lg:pt-14">
      {/* ── Ambient depth layer (hero-local) ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Purple ambient bloom — upper left */}
        <div className="absolute -top-20 -left-20 h-[600px] w-[600px] rounded-full bg-violet-600/12 blur-[160px]" />
        {/* Cyan glow — behind LiTT (right side) */}
        <div className="absolute -top-10 right-[5%] h-[500px] w-[500px] rounded-full bg-cyan-500/8 blur-[150px]" />
        {/* LiTT-green accent — lower right */}
        <div className="absolute -bottom-32 -right-20 h-[400px] w-[400px] rounded-full bg-emerald-500/8 blur-[130px]" />
        {/* Subtle workspace grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(168,85,247,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 35%, black 20%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 70% at 50% 35%, black 20%, transparent 80%)",
          }}
        />
      </div>

      {/* ── Hero grid: text + product proof ── */}
      <div className="relative mx-auto max-w-[1500px]">
        <div className="grid items-start gap-6 lg:grid-cols-[42%_58%] lg:gap-8">
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

            {/* Primary headline — dominant scale */}
            <h1
              className="font-black text-white"
              style={{
                fontSize: "clamp(40px, 5vw, 94px)",
                lineHeight: 0.95,
                letterSpacing: "-0.045em",
              }}
            >
              Bring the idea.
            </h1>

            {/* Secondary headline — gradient */}
            <h2
              className="mt-2 font-black"
              style={{
                fontSize: "clamp(32px, 4vw, 72px)",
                lineHeight: 0.98,
                letterSpacing: "-0.035em",
                background: "linear-gradient(110deg, #a855f7 0%, #c084fc 50%, #34d399 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              LiTT helps you build the rest.
            </h2>

            {/* Support copy — readable, bounded */}
            <p
              className="mt-6 max-w-[600px] leading-[1.6] text-neutral-400"
              style={{ fontSize: "clamp(16px, 1.1vw, 20px)" }}
            >
              One intelligent workspace for{" "}
              <span className="font-semibold text-neutral-200">planning</span>,{" "}
              <span className="font-semibold text-neutral-200">coding</span>,{" "}
              <span className="font-semibold text-neutral-200">creating</span>,{" "}
              <span className="font-semibold text-neutral-200">testing</span>,{" "}
              <span className="font-semibold text-neutral-200">remembering</span>, and{" "}
              <span className="font-semibold text-neutral-200">shipping</span> real projects.
            </p>

            {/* CTAs — premium, 56px high */}
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
              <Link
                href="/sign-up"
                className="group inline-flex h-[56px] items-center gap-2.5 rounded-2xl bg-white px-8 text-base font-black text-black shadow-[0_0_40px_rgba(168,85,247,0.25)] transition hover:shadow-[0_0_60px_rgba(168,85,247,0.45)] hover:scale-[1.02]"
              >
                Start Building Free
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/studio"
                className="inline-flex h-[56px] items-center gap-2.5 rounded-2xl border border-white/12 bg-white/5 px-7 text-base font-semibold text-white backdrop-blur-md transition hover:border-violet-400/30 hover:bg-white/8 hover:scale-[1.02]"
              >
                <Play size={16} className="text-violet-300" />
                Watch LiTT Work
              </Link>
            </div>

            {/* Trust line */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-neutral-500 lg:justify-start">
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

          {/* ══════════ RIGHT: LiTT + Studio operating environment ══════════ */}
          {/* LiTT is the front layer (z-20), Studio panel sits behind it (z-10).
              On mobile, everything stacks vertically. */}
          <div className="relative flex flex-col items-center overflow-visible lg:min-h-[580px]">
            {/* ── LiTT agent — front visual layer (z-20) ── */}
            {/* Positioned to the right, overlapping the Studio panel (z-10) below.
                LiTT's lower body crosses over Studio's upper-right area.
                Shifted right to keep LiTT on-screen at 1920px width. */}
            <div
              className="relative flex items-end justify-center overflow-visible lg:absolute lg:right-0 lg:-top-8 lg:z-[20] xl:right-[-4%] xl:-top-6 2xl:right-[-6%] 2xl:-top-4 litt-hero-mascot"
              style={{ minHeight: "min(460px, 56vh)" }}
            >
              {/* Helmet glow ring — behind the head, breathing */}
              <div
                className="pointer-events-none absolute left-1/2 top-[8%] h-[260px] w-[260px] -translate-x-1/2 rounded-full blur-2xl"
                style={{
                  background:
                    "radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(52,211,153,0.18) 50%, transparent 70%)",
                  animation: "litt-breath 7s ease-in-out infinite",
                }}
              />
              {/* Cyan glow — connects LiTT to the environment */}
              <div
                className="pointer-events-none absolute left-1/2 top-[20%] h-[300px] w-[300px] -translate-x-1/2 rounded-full blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 65%)",
                }}
              />
              {/* Ambient bloom — full body, softer */}
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle at 50% 40%, rgba(168,85,247,0.18) 0%, rgba(52,211,153,0.06) 45%, transparent 70%)",
                }}
              />
              {/* Floating HUD line around the head */}
              <div className="pointer-events-none absolute left-1/2 top-[6%] -translate-x-1/2 motion-reduce:hidden">
                <div
                  className="h-[1px] w-[220px] bg-gradient-to-r from-transparent via-violet-400/30 to-transparent"
                  style={{ animation: "litt-hud-scan 3s ease-in-out infinite" }}
                />
              </div>
              {/* Second HUD scan line — lower, different timing for depth */}
              <div className="pointer-events-none absolute left-1/2 top-[20%] -translate-x-1/2 motion-reduce:hidden">
                <div
                  className="h-[1px] w-[170px] bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent"
                  style={{ animation: "litt-hud-scan 4.5s ease-in-out infinite reverse" }}
                />
              </div>
              {/* Faint HUD data particles around LiTT — 5 floating dots */}
              <div className="pointer-events-none absolute inset-0 motion-reduce:hidden">
                <div
                  className="absolute left-[18%] top-[22%] h-1 w-1 rounded-full bg-violet-400/40"
                  style={{ animation: "litt-particle-drift 7s ease-in-out infinite" }}
                />
                <div
                  className="absolute right-[14%] top-[30%] h-1 w-1 rounded-full bg-cyan-400/30"
                  style={{ animation: "litt-particle-drift 9s ease-in-out infinite 1s" }}
                />
                <div
                  className="absolute left-[22%] top-[45%] h-0.5 w-0.5 rounded-full bg-emerald-400/30"
                  style={{ animation: "litt-particle-drift 8s ease-in-out infinite 2s" }}
                />
                <div
                  className="absolute right-[20%] top-[50%] h-1 w-1 rounded-full bg-violet-400/25"
                  style={{ animation: "litt-particle-drift 10s ease-in-out infinite 0.5s" }}
                />
                <div
                  className="absolute left-[30%] top-[60%] h-0.5 w-0.5 rounded-full bg-cyan-400/20"
                  style={{ animation: "litt-particle-drift 11s ease-in-out infinite 3s" }}
                />
              </div>
              {/* LiTT character — positioned so head + upper body are visible
                  beside the Studio UI stack. Scaled to fit within the viewport
                  at 1920px width without overflowing. */}
              <div
                className="relative flex items-end justify-center"
                style={{ animation: "litt-float 6s ease-in-out infinite" }}
              >
                <div
                  className="relative w-[280px] sm:w-[340px] lg:w-[300px] xl:w-[340px] 2xl:w-[380px] litt-hero-mascot-img"
                  style={{ height: "min(440px, 56vh)" }}
                >
                  <Image
                    src="/brand/litt-agent-hero-v2.png"
                    alt="LiTT — the AI creative operating system agent, full body with helmet, visor, headphones, and streetwear"
                    fill
                    priority
                    sizes="(max-width: 640px) 280px, (max-width: 1024px) 360px, (max-width: 1280px) 320px, (max-width: 1536px) 400px, 440px"
                    className="object-contain object-bottom drop-shadow-[0_8px_40px_rgba(168,85,247,0.3)]"
                  />
                </div>
              </div>
            </div>

            {/* ── Studio operating environment — behind LiTT (z-10) ── */}
            {/* Desktop: absolute at bottom-left of right column; LiTT (z-20) overlaps
                its right portion. Mobile: stacks naturally below LiTT. */}
            <div className="relative z-[10] mt-4 w-full max-w-[560px] lg:absolute lg:bottom-0 lg:left-0 lg:max-w-[580px]">
              {/* ── Studio product frame — real product UI ── */}
              <div
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a14] shadow-[0_12px_80px_rgba(0,0,0,0.7)] transition-all duration-500 hover:border-violet-400/20 hover:shadow-[0_16px_100px_rgba(168,85,247,0.2)]"
                style={{ animation: "litt-card-float 8s ease-in-out infinite" }}
              >
                {/* Window chrome */}
                <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d18] px-4 py-3">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-500/60" />
                    <div className="h-3 w-3 rounded-full bg-amber-500/60" />
                    <div className="h-3 w-3 rounded-full bg-emerald-500/60" />
                  </div>
                  <span className="ml-2 text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500">
                    studio.litlabs.net
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-violet-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400 motion-reduce:hidden" />
                    LiTT IN ACTION
                  </span>
                </div>

                {/* Studio body — file tree + canvas + LiTT activity */}
                <div className="flex" style={{ height: "clamp(280px, 32vh, 380px)" }}>
                  {/* File tree sidebar */}
                  <div className="hidden w-[160px] shrink-0 border-r border-white/6 bg-[#08080f] p-2 sm:block">
                    <div className="mb-2 px-2 text-[9px] font-black uppercase tracking-widest text-neutral-600">
                      Files
                    </div>
                    {FILE_TREE.map((item) => (
                      <div
                        key={item.name}
                        className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                          ("active" in item && item.active)
                            ? "bg-violet-500/15 text-violet-300"
                            : "text-neutral-400"
                        }`}
                        style={{ paddingLeft: `${8 + item.depth * 12}px` }}
                      >
                        {item.type === "folder" ? (
                          <Folder size={11} className="shrink-0 text-neutral-500" />
                        ) : (
                          <FileCode size={11} className="shrink-0 text-neutral-500" />
                        )}
                        <span className="truncate">{item.name}</span>
                      </div>
                    ))}
                  </div>

                  {/* Canvas / preview area */}
                  <div className="relative flex-1 overflow-hidden bg-[#0a0a14]">
                    {/* Preview header */}
                    <div className="flex items-center gap-2 border-b border-white/6 px-3 py-2">
                      <ChevronRight size={12} className="text-neutral-600" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                        Canvas / Preview
                      </span>
                      <span className="ml-auto text-[9px] font-mono text-emerald-400">
                        ● live
                      </span>
                    </div>
                    {/* Preview content — actual generated result */}
                    <div className="relative h-full">
                      <Image
                        src="/studio/creative-engine-hero.png"
                        alt="LiTT Studio — the real creative engine interface with generated output"
                        fill
                        sizes="(max-width: 1024px) 100vw, 620px"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a14] via-transparent to-transparent" />
                      {/* LiTT building indicator — overlay */}
                      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-violet-400/20 bg-[#0a0a14]/90 px-3 py-2 backdrop-blur-sm">
                        <Loader2 size={14} className="animate-spin text-violet-400 motion-reduce:hidden" />
                        <span className="text-[11px] font-bold text-violet-300">
                          LiTT building interface…
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Mission + Runtime panels — readable ── */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                {/* Mission panel */}
                <div className="rounded-xl border border-white/8 bg-[#0a0a14]/90 p-4 backdrop-blur-sm">
                  <div className="mb-2.5 flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400 motion-reduce:hidden" />
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
                      LiTT Mission
                    </span>
                  </div>
                  <div className="mb-3 text-xs font-bold text-neutral-300">
                    Build the launch experience.
                  </div>
                  <div className="space-y-1.5">
                    {MISSION_STEPS.map((step) => (
                      <div key={step.label} className="flex items-center gap-2 text-[11px]">
                        {step.state === "done" && (
                          <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                        )}
                        {step.state === "active" && (
                          <Loader2 size={12} className="shrink-0 animate-spin text-orange-400 motion-reduce:hidden" />
                        )}
                        {step.state === "pending" && (
                          <Circle size={12} className="shrink-0 text-neutral-700" />
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
                <div className="rounded-xl border border-white/8 bg-[#0a0a14]/90 p-4 backdrop-blur-sm">
                  <div className="mb-2.5 flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 motion-reduce:hidden" />
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
                      Runtime
                    </span>
                  </div>
                  <div className="mb-2.5 text-sm font-bold text-emerald-400">ONLINE</div>
                  <div className="space-y-2">
                    {RUNTIME_SERVICES.map((svc) => (
                      <div
                        key={svc.label}
                        className="flex items-center justify-between text-[11px] font-mono"
                      >
                        <span className="font-bold text-neutral-400">{svc.label}</span>
                        <span className={svc.color}>{svc.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Terminal — legitimate proof surface ── */}
              <div className="mt-3 rounded-xl border border-white/8 bg-[#06060e]/95 p-4 font-mono backdrop-blur-sm">
                <div className="mb-2 flex items-center gap-1.5">
                  <TerminalIcon size={12} className="text-neutral-600" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-600">
                    Terminal
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-700">bash</span>
                </div>
                <div className="space-y-0.5 text-[11px] leading-relaxed">
                  <div className="text-emerald-400">
                    <span className="text-neutral-600">$</span> litt run build
                  </div>
                  <div className="text-neutral-500">
                    <span className="text-emerald-400">✓</span> workspace loaded
                  </div>
                  <div className="text-neutral-500">
                    <span className="text-emerald-400">✓</span> components generated
                  </div>
                  <div className="text-neutral-500">
                    <span className="text-emerald-400">✓</span> tests passed
                  </div>
                  <div className="text-neutral-500">
                    <span className="text-emerald-400">✓</span> production ready
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

      {/* Hero-local animations — inline <style> to bypass Tailwind v4 purge.
          Respects prefers-reduced-motion. */}
      <style>{`
        @keyframes litt-breath {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.08); }
        }
        @keyframes litt-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes litt-hud-scan {
          0%, 100% { opacity: 0.2; transform: translateX(-20px); }
          50%      { opacity: 0.6; transform: translateX(20px); }
        }
        @keyframes litt-particle-drift {
          0%, 100% { opacity: 0.2; transform: translateY(0) translateX(0); }
          25%      { opacity: 0.5; transform: translateY(-12px) translateX(6px); }
          50%      { opacity: 0.3; transform: translateY(-6px) translateX(-4px); }
          75%      { opacity: 0.4; transform: translateY(-10px) translateX(8px); }
        }
        @keyframes litt-card-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="litt-breath"],
          [style*="litt-float"],
          [style*="litt-hud-scan"],
          [style*="litt-particle-drift"],
          [style*="litt-card-float"] { animation: none !important; }
        }
        /* At very wide viewports (1700px+) give LiTT a bit more room to the right
           and bump up the image size so it doesn't look undersized on ultrawide. */
        @media (min-width: 1700px) {
          .litt-hero-mascot {
            right: -10% !important;
            top: 0rem !important;
          }
          .litt-hero-mascot-img {
            width: 420px !important;
          }
        }
      `}</style>
    </section>
  );
}
