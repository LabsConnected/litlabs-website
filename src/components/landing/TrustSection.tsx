"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, FileStack, GitBranch, Play, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { useEggHunt } from "./EggHunt";

const PRODUCT_FACTS = [
  "Free starter plan with no credit card required",
  "Your project files and generated assets stay exportable",
  "Sensitive actions require your approval",
  "Project context persists across sessions",
  "Beta capabilities are labeled clearly",
] as const;

const TRUST_ITEMS = [
  {
    icon: FileStack,
    title: "Your project stays yours",
    copy: "Files and generated assets remain in your workspace and are exportable. No lock-in.",
  },
  {
    icon: ShieldCheck,
    title: "Sensitive actions require approval",
    copy: "LiTT does not deploy, delete, or make production changes without your explicit confirmation.",
  },
  {
    icon: Undo2,
    title: "Project history survives the chat",
    copy: "Context, decisions, and checkpoints carry forward. Return tomorrow without rebuilding the conversation.",
  },
  {
    icon: Download,
    title: "No lock-in",
    copy: "Download your work and take it anywhere. The output belongs to your project, not the chat interface.",
  },
  {
    icon: GitBranch,
    title: "Connect GitHub",
    copy: "Work directly on existing repositories. GitHub connection available on Creator and Pro Builder plans.",
  },
  {
    icon: Sparkles,
    title: "Beta features labeled clearly",
    copy: "Voice, Terminal, and Deploy are in Beta. We label them honestly—not buried in fine print.",
  },
];

/* Egg 1 — the gem in the wordmark loves attention (tap ×5). */
function GemButton() {
  const { findEgg } = useEggHunt();
  const [taps, setTaps] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tap = () => {
    const next = taps + 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTaps(0), 2600);
    if (next >= 5) {
      setTaps(0);
      findEgg(
        "gem",
        "💎 Egg 1 — The Gem.",
        "You tapped the LiTT gem five times. It noticed. It approves.",
      );
    } else {
      setTaps(next);
    }
  };

  return (
    <button
      type="button"
      aria-label="The LiTT gem"
      className="litt-gem mt-4 shrink-0"
      style={{ transform: `rotate(45deg) scale(${1 + taps * 0.12})` }}
      onClick={tap}
    />
  );
}

/* Egg 5 — a firefly drifts around the closing panel. Catch it. */
function FireflyButton() {
  const { findEgg } = useEggHunt();
  const [pos, setPos] = useState({ x: 8, y: 16 });
  const dir = useRef({ dx: 1, dy: 1 });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setPos((p) => {
        let { x, y } = p;
        let { dx, dy } = dir.current;
        x += dx * 1.4;
        y += dy * 0.9;
        if (x > 86 || x < 4) dx *= -1;
        if (y > 68 || y < 8) dy *= -1;
        dir.current = { dx, dy };
        return { x, y };
      });
    }, 140);
    return () => clearInterval(timer);
  }, []);

  return (
    <button
      type="button"
      aria-label="Catch the firefly"
      className="litt-firefly"
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      onClick={() =>
        findEgg(
          "fly",
          "🪲 Egg 5 — Firefly Caught.",
          "The little light that works after midnight — just like the people who build with LiTT.",
        )
      }
    />
  );
}

const GARDEN_STAGES = ["🌰", "🌱", "🌿", "🌳"] as const;
const GARDEN_MESSAGES = [
  "Every great site starts as a seed of an idea. Give this one some water.",
  "A sprout! One sentence of an idea is all it ever takes to start.",
  "It's growing — pages, photos, the works. Keep going.",
  "A full-grown LiTTree. 🌳 That's the whole pitch: describe it, and watch it grow.",
] as const;

/* Egg 4 — water the seed at the foot of the page until it grows. */
function GardenStrip() {
  const { findEgg, foundCount } = useEggHunt();
  const [stage, setStage] = useState(0);
  const [pulse, setPulse] = useState(false);

  const water = () => {
    if (stage >= GARDEN_STAGES.length - 1) return;
    const next = stage + 1;
    setStage(next);
    setPulse(true);
    setTimeout(() => setPulse(false), 380);
    if (next === GARDEN_STAGES.length - 1) {
      findEgg(
        "garden",
        "🌳 Egg 4 — The Garden.",
        "You grew a LiTTree from a seed in four taps. Websites here grow about that fast.",
      );
    }
  };

  return (
    <div data-reveal className="relative mx-auto mt-10 max-w-[1500px]">
      <div className="litt-garden">
        <span
          className="litt-garden-tree"
          style={{ transform: pulse ? "scale(1.25)" : "scale(1)" }}
          aria-hidden="true"
        >
          {GARDEN_STAGES[stage]}
        </span>
        <p className="min-w-[220px] flex-1 text-sm font-semibold leading-6 text-[#37463A]">
          <strong className="font-black text-[#0E1510]">The LiTT garden.</strong>{" "}
          {GARDEN_MESSAGES[stage]}
        </p>
        <button
          type="button"
          className="litt-water-btn"
          onClick={water}
          disabled={stage >= GARDEN_STAGES.length - 1}
        >
          {stage >= GARDEN_STAGES.length - 1
            ? "🌳 Fully grown"
            : stage === 0
              ? "💧 Water the seed"
              : `💧 Water again (${stage} / 3)`}
        </button>
        <span className="rounded-full border border-[#177A36] bg-white px-3 py-1.5 font-mono text-xs font-semibold tracking-wide text-[#0C5A26]">
          🥚 Egg hunt · {foundCount} / 5 found
        </span>
      </div>
      <p className="mt-4 text-xs font-semibold leading-5 text-[#63745F]">
        Psst — this page hides 5 little surprises, and every one works with a tap, not just a keyboard: the gem beside the wordmark above likes attention, the hero pipeline runs in order, the headline keeps a secret, something glows in the dark panel above… and the garden grows. Desktop explorers: try typing{" "}
        <span className="font-mono font-bold text-[#0C5A26]">litt</span>, or the classic ↑↑↓↓←→←→ B A.
      </p>
    </div>
  );
}

export function TrustSection() {
  return (
    <section className="litt-section relative overflow-hidden px-5 lg:px-8">
      {/* Trust Q&A grid */}
      <div data-reveal className="relative mx-auto max-w-[1500px]">
        <div className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <ShieldCheck size={13} /> Trust & control
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#0E1510]">
            Your work. <span className="litt-gradient-text">Your control.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-[#63745F] sm:text-lg sm:leading-8">
            LiTT is built around your ownership, your approvals, and your ability to take the work anywhere.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST_ITEMS.map((item, index) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                data-reveal
                className="litt-trust-card"
                style={{ "--reveal-index": index } as React.CSSProperties}
              >
                <div className="flex items-center gap-3">
                  <span className="litt-trust-icon"><Icon size={18} /></span>
                  <h3 className="text-base font-black tracking-[-0.02em] text-[#0E1510]">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#63745F]">{item.copy}</p>
              </article>
            );
          })}
        </div>
      </div>

      {/* Final CTA — deep-green panel, clean wordmark in type. The old
          blue-tree logo graphic is gone (Larry's call, 2026-11-10). */}
      <div data-reveal className="litt-final-cta litt-on-dark relative mx-auto mt-16 max-w-[1500px] overflow-hidden rounded-[2rem]">
        <div className="litt-grid-fade pointer-events-none absolute inset-0 opacity-15" />
        <FireflyButton />

        <div className="relative grid min-h-[520px] lg:grid-cols-[1.05fr_.95fr]">
          <div className="relative z-10 flex flex-col justify-center p-7 sm:p-10 lg:p-14 xl:p-16">
            <div className="litt-eyebrow !mx-0"><Sparkles size={13} /> Your next project starts here</div>
            <h2 className="mt-6 max-w-3xl text-[clamp(3rem,6.5vw,6.6rem)] font-black leading-[0.88] tracking-[-0.07em] text-white">
              Turn the next idea into <span className="litt-gradient-text">something real.</span>
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
              Give LiTT the mission and a place to build. LiTT will help plan the work, create the pieces, verify the result, and keep the context for what comes next.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="litt-primary-button"
                onClick={() => track("hero_cta_click", { source: "trust_cta" })}
              >
                Start building free <ArrowRight size={16} />
              </Link>
              <a
                href="#how-it-works"
                className="litt-secondary-button"
                onClick={() => track("watch_litt_click", { source: "trust_cta" })}
              >
                <Play size={13} fill="currentColor" /> See how it works
              </a>
            </div>

            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {PRODUCT_FACTS.map((fact) => (
                <div key={fact} className="flex items-start gap-2.5 text-xs font-semibold leading-5 text-white/60">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-accent/18 bg-accent/8 text-accent"><Check size={11} /></span>
                  {fact}
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-bold text-white/40">
              <span className="inline-flex items-center gap-1.5 text-white/55"><ShieldCheck size={12} className="text-accent" /> Built around your control</span>
              <Link href="/privacy" className="transition hover:text-white">Privacy</Link>
              <Link href="/terms" className="transition hover:text-white">Terms</Link>
              <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
            </div>
          </div>

          <div className="relative flex min-h-[380px] flex-col items-center justify-center p-10 lg:min-h-full">
            <div className="flex items-start">
              <span className="litt-wordmark text-[clamp(5rem,10vw,9.5rem)] text-white">LiTT</span>
              <GemButton />
            </div>
            <p className="mt-5 text-[11px] font-black uppercase tracking-[0.22em] text-white/40">
              LiTTree LabStudios · litlabs.net
            </p>
            <div className="mt-8 rounded-full border border-accent/22 bg-[#05070d]/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-[#caff85] backdrop-blur-xl">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-accent-glow" /> LiTT online
            </div>
          </div>
        </div>
      </div>

      <GardenStrip />
    </section>
  );
}
