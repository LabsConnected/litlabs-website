"use client";

import Link from "next/link";
import { ArrowRight, FileCode2, GitBranch, Play, Terminal, Check } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * RealProductProof — Product video section for the LiTT launch trailer.
 *
 * Plays the real LiTT product trailer (vertical 9:16, 10s) in a centered
 * phone-style frame with a poster pulled from the trailer's end card.
 *
 * Assets live in `public/demos/`:
 * - litt-trailer.webm (VP9, 720x1280) — primary source; plays in every
 *   modern browser including Chromium builds without proprietary codecs
 * - litt-trailer.mp4 (H.264, 720x1280) — fallback for older players
 * - litt-trailer-poster.jpg (720x1280)
 */

const VIDEO_SOURCES = [
  { src: "/demos/litt-trailer.webm", type: "video/webm" },
  { src: "/demos/litt-trailer.mp4", type: "video/mp4" },
];
const POSTER_SRC = "/demos/litt-trailer-poster.jpg";

const DEMO_STEPS = [
  { label: "Mission understood", icon: Check },
  { label: "Plan generated", icon: Check },
  { label: "Files changing", icon: FileCode2 },
  { label: "Terminal executing", icon: Terminal },
  { label: "Preview updating", icon: Play },
  { label: "Verification passed", icon: Check },
  { label: "Approval ready", icon: GitBranch },
];

// The real LiTT product trailer is live in public/demos/.
const HAS_REAL_VIDEO = true;

export function RealProductProof() {
  const handleWatchClick = () => {
    track("watch_litt_click", { source: "real_proof" });
  };

  return (
    <section id="real-proof" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[680px] -translate-x-1/2 rounded-full bg-accent/6 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Play size={13} /> Real session
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            See LiTT work on a <span className="litt-gradient-text">real project.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            A real LiTT session. Real project files. Real tools. Real output.
          </p>
        </div>

        <div data-reveal className="mt-12">
          {HAS_REAL_VIDEO ? (
            <div className="mx-auto max-w-[380px]">
              <div className="litt-demo-shell overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,.55)]">
                <video
                  className="aspect-[9/16] w-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  poster={POSTER_SRC}
                  controls
                  preload="metadata"
                >
                  {VIDEO_SOURCES.map((s) => (
                    <source key={s.src} src={s.src} type={s.type} />
                  ))}
                </video>
              </div>
            </div>
          ) : (
            <div className="litt-video-placeholder">
              <div className="litt-video-placeholder-inner">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl border border-accent/24 bg-accent/8 text-accent shadow-accent-glow">
                    <Play size={28} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-white">A mission, step by step</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/42">
                      Every LiTT session follows the same visible path — understand
                      the brief, plan the work, edit real files, run tools, verify
                      the result, and hand it back to you.
                    </p>
                  </div>
                </div>

                <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {DEMO_STEPS.map((step, index) => {
                    const Icon = step.icon;
                    return (
                      <div
                        key={step.label}
                        className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-[#05070d] px-3 py-3"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5 font-mono text-[10px] font-black text-accent">
                          0{index + 1}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/58">
                          <Icon size={12} className="text-[#65f4ff]" />
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
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
          <Link
            href="/showcase/artist-launch-site"
            className="litt-secondary-button"
          >
            See an example session <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}
