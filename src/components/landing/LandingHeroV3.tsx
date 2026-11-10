"use client";

import { brand } from "@/lib/design/litt-tokens";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Coins,
  Eye,
  FileCode2,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  PencilLine,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { track } from "@/lib/analytics";
import { useEggHunt } from "./EggHunt";

const MISSION_STEPS = [
  { label: "Brief understood", state: "done" },
  { label: "Plan generated", state: "done" },
  { label: "Workspace changing", state: "active" },
  { label: "Verification", state: "pending" },
] as const;

const RUNTIME = [
  { label: "Agent", value: "working", color: brand.primary.DEFAULT },
  { label: "Files", value: "12 changed", color: "#8FD14F" },
  { label: "Memory", value: "synced", color: "#E8A317" },
] as const;

const PIPELINE = [
  { label: "Describe", icon: MessageSquareText },
  { label: "Generate", icon: Sparkles },
  { label: "Preview", icon: Eye },
  { label: "Edit", icon: PencilLine },
  { label: "Verify", icon: ShieldCheck },
  { label: "Publish", icon: Rocket },
] as const;

const RIBBON = [
  { icon: ListChecks, strong: "6 plain steps", rest: ", start to live" },
  { icon: LayoutGrid, strong: "1 workspace", rest: " — no tab-hopping" },
  { icon: ShieldCheck, strong: "Every build checked", rest: " before publish" },
  { icon: Coins, strong: "0 LiTTBits", rest: " charged on a failed build" },
] as const;

export function LandingHeroV3() {
  const { isSignedIn } = useClerkAuth();
  const { findEgg } = useEggHunt();
  const [mounted, setMounted] = useState(false);

  /* Pipeline: gentle auto-highlight until the visitor joins in, then the
     run-it-in-order egg takes over (mockup round 3 behaviour). */
  const [autoIdx, setAutoIdx] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [seq, setSeq] = useState(0);
  const [lit, setLit] = useState<boolean[]>(() => PIPELINE.map(() => false));
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (interacted) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setAutoIdx((i) => (i + 1) % PIPELINE.length);
    }, 1400);
    return () => clearInterval(timer);
  }, [interacted]);

  const pipeHit = (i: number) => {
    setInteracted(true);
    if (i === seq) {
      const next = lit.map((v, j) => v || j === i);
      setLit(next);
      if (seq === PIPELINE.length - 1) {
        setSeq(0);
        findEgg(
          "pipe",
          "🚀 Egg 2 — Full Run.",
          "Describe → Generate → Preview → Edit → Verify → Publish. You just shipped it — that's the whole LiTT loop.",
        );
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setLit(PIPELINE.map(() => false)), 2400);
      } else {
        setSeq(seq + 1);
      }
    } else if (i === 0) {
      setLit(PIPELINE.map((_, j) => j === 0));
      setSeq(1);
    } else {
      setLit(PIPELINE.map(() => false));
      setSeq(0);
    }
  };

  /* Headline triple-tap — the other half of egg 3. */
  const headlineTaps = useRef(0);
  const headlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headlineTap = () => {
    headlineTaps.current += 1;
    if (headlineTimer.current) clearTimeout(headlineTimer.current);
    headlineTimer.current = setTimeout(() => {
      headlineTaps.current = 0;
    }, 2200);
    if (headlineTaps.current >= 3) {
      headlineTaps.current = 0;
      findEgg(
        "type",
        "✨ Egg 3 — Headline Magic.",
        "Triple-tap the promise and it sparkles back. “LiTT builds it” — and it just proved it likes you.",
      );
    }
  };

  const primaryHref = mounted && isSignedIn ? "/studio" : "/sign-up";
  const primaryLabel = mounted && isSignedIn ? "Open Studio" : "Start building free";

  return (
    <section className={`litt-hero relative overflow-hidden pt-[68px] ${mounted ? "litt-hero-ready" : ""}`}>
      <div className="litt-hero-aurora pointer-events-none absolute inset-0" />
      <div className="litt-hero-grid pointer-events-none absolute inset-0" />
      <div className="litt-hero-orb litt-hero-orb-one pointer-events-none" />
      <div className="litt-hero-orb litt-hero-orb-two pointer-events-none" />

      <div className="relative mx-auto max-w-[1500px] px-5 pb-16 pt-14 lg:px-8 lg:pb-20 lg:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] xl:gap-16">
          <div className="relative z-10 max-w-3xl">
            <div className="litt-live-pill litt-hero-reveal litt-hero-step-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              LiTT is online{" "}
              <span className="h-3 w-px bg-[#CFDEC4]" />{" "}
              Example activity
            </div>

            <p className="litt-hero-reveal litt-hero-step-2 mt-7 text-[11px] font-black uppercase tracking-[0.22em] text-[#177A36]">
              LiTT Studio · AI website builder
            </p>

            <h1 className="litt-hero-reveal litt-hero-step-2 mt-3 max-w-[820px] text-[clamp(3.2rem,7vw,6.8rem)] font-black leading-[0.9] tracking-[-0.06em] text-[#0E1510]">
              Describe it.
              <span
                className="litt-hero-title-gradient mt-2 block cursor-pointer select-none"
                onClick={headlineTap}
              >
                LiTT builds it.
              </span>
            </h1>

            <p className="litt-hero-reveal litt-hero-step-3 mt-7 max-w-2xl text-lg leading-8 text-[#37463A] sm:text-xl sm:leading-9">
              LiTT is a complete building workspace — not a chatbot with a code box. You describe the site you want in plain words, and LiTT generates it, shows you a live preview, lets you edit by talking, checks the work, and publishes it to a real address.
            </p>

            <div className="litt-hero-reveal litt-hero-step-4 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={primaryHref}
                className="litt-primary-button"
                onClick={() => track("hero_cta_click", { destination: primaryHref })}
              >
                <Zap size={17} fill="currentColor" /> {primaryLabel} <ArrowRight size={16} />
              </Link>
              <a
                href="#real-project-walkthrough"
                className="litt-secondary-button"
                onClick={() => track("watch_litt_click", { source: "hero" })}
              >
                <Play size={13} fill="currentColor" /> Watch the film
              </a>
            </div>

            <div className="litt-hero-reveal litt-hero-step-5 mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold text-[#63745F] sm:text-xs">
              {["No code to write", "Live preview as it builds", "Publish to your own LiTT address"].map((fact) => (
                <span key={fact} className="inline-flex items-center gap-1.5">
                  <Check size={12} className="text-accent" /> {fact}
                </span>
              ))}
            </div>

            <div className="litt-hero-reveal litt-hero-step-6 mt-10">
              <div className="litt-pipe" role="group" aria-label="The LiTT pipeline: describe, generate, preview, edit, verify, publish">
                {PIPELINE.map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <span key={step.label} className="inline-flex items-center gap-[0.45rem]">
                      <button
                        type="button"
                        onClick={() => pipeHit(i)}
                        aria-pressed={lit[i]}
                        className={`litt-pipe-node ${lit[i] ? "is-lit" : ""} ${!interacted && autoIdx === i ? "is-auto" : ""}`}
                      >
                        <Icon size={13} /> {step.label}
                      </button>
                      {i < PIPELINE.length - 1 ? (
                        <span aria-hidden="true" className="litt-pipe-arrow">→</span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="litt-hero-reveal litt-hero-step-3 relative z-10 mx-auto w-full max-w-[760px] lg:mx-0">
            <div className="litt-command-glow pointer-events-none absolute -inset-6 rounded-[2.5rem]" />
            <div className="litt-command-deck">
              <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]/75" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ffd166]/75" />
                  <span className="h-2.5 w-2.5 rounded-full bg-accent/75" />
                </div>
                <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/40 sm:text-[10px]">
                  Studio / Recorded preview{" "}
                  <span className="rounded-full border border-accent/25 bg-accent/8 px-2 py-0.5 text-accent">Example</span>
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
                    <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-white/42">Example mission</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-accent-glow" />
                  </div>
                  <p className="mt-2 text-xs font-black text-white sm:text-sm">Build the launch experience.</p>
                  <div className="mt-3 space-y-2">
                    {MISSION_STEPS.map((step, index) => (
                      <div key={step.label} className="flex items-center gap-2">
                        {step.state === "done" ? (
                          <CheckCircle2 size={12} className="shrink-0 text-accent" />
                        ) : step.state === "active" ? (
                          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                            <span className="absolute h-3 w-3 animate-ping rounded-full bg-[#8FD14F]/35" />
                            <span className="relative h-1.5 w-1.5 rounded-full bg-[#8FD14F]" />
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
                    <span className="font-mono text-[8px] font-bold text-accent">exit 0</span>
                  </div>
                  <div className="litt-terminal-lines grid gap-1 px-3 py-3 font-mono text-[9px] sm:grid-cols-2 sm:text-[10px]">
                    <div className="text-white/55"><span className="text-[#8FD14F]">$</span> litt run mission</div>
                    <div className="text-accent">✓ Recorded Studio preview</div>
                    <div className="text-accent">✓ Example components generated</div>
                    <div className="text-accent">✓ Example verification passed</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="litt-floating-badge -right-2 top-[26%] hidden xl:flex">
              <FileCode2 size={14} className="text-[#177A36]" /> Real files
            </div>
            <div className="litt-floating-badge -left-5 bottom-[14%] hidden xl:flex">
              <ShieldCheck size={14} className="text-accent" /> Approval ready
            </div>
          </div>
        </div>

        <div data-reveal className="litt-ribbon mt-14">
          {RIBBON.map((cell) => {
            const Icon = cell.icon;
            return (
              <div key={cell.strong}>
                <Icon size={15} />
                <span>
                  <strong>{cell.strong}</strong>
                  {cell.rest}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
