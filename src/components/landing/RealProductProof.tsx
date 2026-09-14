"use client";

import Link from "next/link";
import { ArrowRight, FileCode2, GitBranch, Play, Terminal, Check } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * RealProductProof — "Inside a session" pipeline section.
 *
 * Shows the actual stages every LiTT mission runs through, from brief to
 * approval-ready result. This is honest product copy: no fake recording —
 * just the real pipeline rendered as a timeline.
 */

const SESSION_STEPS = [
  { label: "Mission understood", icon: Check },
  { label: "Plan generated", icon: Check },
  { label: "Files changing", icon: FileCode2 },
  { label: "Terminal executing", icon: Terminal },
  { label: "Preview updating", icon: Play },
  { label: "Verification passed", icon: Check },
  { label: "Approval ready", icon: GitBranch },
];

export function RealProductProof() {
  const handleWatchClick = () => {
    track("watch_litt_click", { source: "real_proof" });
  };

  return (
    <section id="real-proof" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[680px] -translate-x-1/2 rounded-full bg-[#a8ff2f]/6 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Play size={13} /> Inside a session
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            See LiTT work on a <span className="litt-gradient-text">real project.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            One brief in, a verified project out. Every session runs the same
            visible pipeline — plan, build, verify, approve.
          </p>
        </div>

        <div data-reveal className="litt-demo-shell mt-12">
          <div className="rounded-2xl border border-white/8 bg-[#05070d] px-5 py-6 sm:px-8 sm:py-8">
            <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/38">
                Session pipeline
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a8ff2f]/70">
                Brief → verified result
              </p>
            </div>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SESSION_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.label}
                    className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5 font-mono text-[10px] font-black text-[#a8ff2f]">
                      0{index + 1}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/58">
                      <Icon size={12} className="text-[#65f4ff]" />
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-6 text-center text-[11px] leading-5 text-white/38">
              Every stage is inspectable in the workspace — files, diffs,
              terminal output, and previews stay visible while LiTT works.
            </p>
          </div>
        </div>

        <div data-reveal className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/sign-up"
            className="litt-primary-button"
            onClick={() => track("hero_cta_click", { source: "real_proof" })}
          >
            Start building free <ArrowRight size={16} />
          </Link>
          <a
            href="#how-it-works"
            className="litt-secondary-button"
            onClick={handleWatchClick}
          >
            <Play size={13} fill="currentColor" /> See the walkthrough
          </a>
        </div>
      </div>
    </section>
  );
}
