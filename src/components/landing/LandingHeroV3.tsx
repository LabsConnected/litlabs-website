"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  FileCode2,
  GitBranch,
  Play,
  ShieldCheck,
  Terminal,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

const MISSION_STEPS = [
  { label: "Brief understood", state: "done" },
  { label: "Plan generated", state: "done" },
  { label: "Workspace changing", state: "active" },
  { label: "Verification", state: "pending" },
] as const;

const RUNTIME = [
  { label: "Agent", value: "working", color: "#a8ff2f" },
  { label: "Files", value: "12 changed", color: "#65f4ff" },
  { label: "Memory", value: "synced", color: "#b58cff" },
] as const;

export function LandingHeroV3() {
  const { isSignedIn } = useClerkAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const primaryHref = mounted && isSignedIn ? "/studio" : "/sign-up";
  const primaryLabel = mounted && isSignedIn ? "Enter Studio" : "Start building free";

  return (
    <section className={`litt-hero relative overflow-hidden pt-[68px] ${mounted ? "litt-hero-ready" : ""}`}>
      <div className="litt-hero-aurora pointer-events-none absolute inset-0" />
      <div className="litt-hero-grid pointer-events-none absolute inset-0" />
      <div className="litt-hero-orb litt-hero-orb-one pointer-events-none" />
      <div className="litt-hero-orb litt-hero-orb-two pointer-events-none" />

      <div className="relative mx-auto grid min-h-[calc(100svh-68px)] max-w-[1500px] items-center gap-12 px-5 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-20 xl:gap-16">
        <div className="relative z-10 max-w-3xl">
          <div className="litt-live-pill litt-hero-reveal litt-hero-step-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#a8ff2f] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#a8ff2f]" />
            </span>
            LiTT is online
            <span className="h-3 w-px bg-white/15" />
            Missions active
          </div>

          <h1 className="litt-hero-reveal litt-hero-step-2 mt-7 max-w-[820px] text-[clamp(3.4rem,7.3vw,7.4rem)] font-black leading-[0.86] tracking-[-0.075em] text-white">
            Bring the idea.
            <span className="litt-hero-title-gradient mt-2 block">LiTT builds the rest.</span>
          </h1>

          <p className="litt-hero-reveal litt-hero-step-3 mt-7 max-w-2xl text-lg leading-8 text-white/58 sm:text-xl sm:leading-9">
            LiTT plans, codes, creates, tests, remembers, uses tools, changes real projects, verifies the result, and helps ship.
          </p>

          <div className="litt-hero-reveal litt-hero-step-4 mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={primaryHref} className="litt-primary-button">
              <Zap size={17} fill="currentColor" /> {primaryLabel} <ArrowRight size={16} />
            </Link>
            <a href="#how-it-works" className="litt-secondary-button">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/8">
                <Play size={11} fill="currentColor" />
              </span>
              Watch LiTT work
            </a>
          </div>

          <div className="litt-hero-reveal litt-hero-step-5 mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold text-white/38 sm:text-xs">
            {["Free starter plan", "No credit card required", "Connect GitHub", "Your files stay yours"].map((fact) => (
              <span key={fact} className="inline-flex items-center gap-1.5">
                <Check size={12} className="text-[#a8ff2f]" /> {fact}
              </span>
            ))}
          </div>

          <div className="litt-hero-reveal litt-hero-step-6 mt-11 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: Code2, label: "Build products" },
              { icon: WandSparkles, label: "Create media" },
              { icon: GitBranch, label: "Run workflows" },
              { icon: ShieldCheck, label: "Ship safely" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="litt-outcome-chip">
                <Icon size={14} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="litt-hero-reveal litt-hero-step-3 relative z-10 mx-auto w-full max-w-[760px] lg:mx-0">
          <div className="litt-command-glow pointer-events-none absolute -inset-6 rounded-[2.5rem]" />
          <div className="litt-command-deck">
            <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 sm:px-5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]/75" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#ffd166]/75" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#a8ff2f]/75" />
              </div>
              <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/40 sm:text-[10px]">
                Studio / Mission control
                <span className="rounded-full border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-2 py-0.5 text-[#a8ff2f]">Live</span>
              </div>
            </div>

            <div className="relative aspect-[0.75/1] overflow-hidden sm:aspect-[1.32/1]">
              <Image
                src="/brand/litt-agent-hero-v2.png"
                alt="LiTT, the LiTTree AI operator, working inside a neon digital workspace"
                fill
                priority
                loading="eager"
                sizes="(max-width: 1024px) 92vw, 52vw"
                className="object-cover object-[58%_50%] opacity-80"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,.05),rgba(3,5,10,.18)_48%,rgba(3,5,10,.94))]" />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,10,.76),transparent_38%,transparent_70%,rgba(3,5,10,.55))]" />
              <div className="litt-scanline pointer-events-none absolute inset-x-0 top-0 h-24" />

              <div className="absolute left-3 top-3 w-[47%] rounded-xl border border-white/12 bg-[#050810]/84 p-3 shadow-2xl backdrop-blur-xl sm:left-5 sm:top-5 sm:w-[42%] sm:p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-white/42">Current mission</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f] shadow-[0_0_12px_#a8ff2f]" />
                </div>
                <p className="mt-2 text-xs font-black text-white sm:text-sm">Build the launch experience.</p>
                <div className="mt-3 space-y-2">
                  {MISSION_STEPS.map((step, index) => (
                    <div key={step.label} className="flex items-center gap-2">
                      {step.state === "done" ? (
                        <CheckCircle2 size={12} className="shrink-0 text-[#a8ff2f]" />
                      ) : step.state === "active" ? (
                        <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                          <span className="absolute h-3 w-3 animate-ping rounded-full bg-[#65f4ff]/35" />
                          <span className="relative h-1.5 w-1.5 rounded-full bg-[#65f4ff]" />
                        </span>
                      ) : (
                        <span className="h-3 w-3 shrink-0 rounded-full border border-white/20" />
                      )}
                      <span className={`text-[9px] font-bold sm:text-[10px] ${step.state === "pending" ? "text-white/28" : "text-white/65"}`}>
                        <span className="mr-1 text-white/25">0{index + 1}</span> {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="absolute right-3 top-3 hidden w-32 rounded-xl border border-white/12 bg-[#050810]/82 p-3 shadow-2xl backdrop-blur-xl sm:right-5 sm:top-5 sm:block">
                <div className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-white/38">Runtime</div>
                <div className="mt-3 space-y-2.5">
                  {RUNTIME.map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between gap-2 text-[8px] font-black uppercase tracking-wider">
                        <span className="text-white/35">{item.label}</span>
                        <span style={{ color: item.color }}>{item.value}</span>
                      </div>
                      <div className="mt-1 h-px overflow-hidden bg-white/8"><div className="litt-runtime-line h-full w-3/4" style={{ backgroundColor: item.color }} /></div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/12 bg-[#03050a]/92 shadow-2xl backdrop-blur-xl sm:inset-x-5 sm:bottom-5">
                <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
                  <div className="flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-[0.15em] text-white/38"><Terminal size={11} /> Terminal</div>
                  <span className="font-mono text-[8px] font-bold text-[#a8ff2f]">exit 0</span>
                </div>
                <div className="litt-terminal-lines grid gap-1 px-3 py-3 font-mono text-[9px] sm:grid-cols-2 sm:text-[10px]">
                  <div className="text-white/55"><span className="text-[#65f4ff]">$</span> litt run mission</div>
                  <div className="text-[#a8ff2f]">✓ workspace loaded</div>
                  <div className="text-[#a8ff2f]">✓ components generated</div>
                  <div className="text-[#a8ff2f]">✓ verification passed</div>
                </div>
              </div>
            </div>
          </div>

          <div className="litt-floating-badge -right-2 top-[26%] hidden xl:flex">
            <FileCode2 size={14} className="text-[#65f4ff]" /> Real files
          </div>
          <div className="litt-floating-badge -left-5 bottom-[14%] hidden xl:flex">
            <ShieldCheck size={14} className="text-[#a8ff2f]" /> Approval ready
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-[#a8ff2f]/40 to-transparent" />
    </section>
  );
}
