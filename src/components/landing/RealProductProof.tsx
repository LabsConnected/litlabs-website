"use client";

import Link from "next/link";
import { ArrowRight, FileCode2, GitBranch, Play, Terminal, Check } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * RealProductProof — Production-ready video section for authentic LiTT recordings.
 *
 * No fake recording exists yet. This component renders an honest placeholder
 * that clearly states what asset needs to be recorded, and makes replacing
 * the placeholder trivial.
 *
 * TO REPLACE WITH A REAL RECORDING:
 * 1. Add a video file to `public/demos/litt-real-session.mp4` (H.264, 1280x720, 20-45s)
 * 2. Add a poster image to `public/demos/litt-real-session-poster.jpg` (1280x720)
 * 3. Add a mobile-optimized version to `public/demos/litt-real-session-mobile.mp4` (640x360)
 * 4. Set `VIDEO_SRC` and `POSTER_SRC` below to the real paths.
 * 5. The component automatically switches to the real <video> element.
 */

const VIDEO_SRC = "/demos/litt-real-session.mp4";
const POSTER_SRC = "/demos/litt-real-session-poster.jpg";
const VIDEO_MOBILE_SRC = "/demos/litt-real-session-mobile.mp4";

const DEMO_STEPS = [
  { label: "Mission understood", icon: Check },
  { label: "Plan generated", icon: Check },
  { label: "Files changing", icon: FileCode2 },
  { label: "Terminal executing", icon: Terminal },
  { label: "Preview updating", icon: Play },
  { label: "Verification passed", icon: Check },
  { label: "Approval ready", icon: GitBranch },
];

// Detect whether the real video asset exists at build time.
// In production with a real file, this will be true.
// For now, we use a placeholder.
const HAS_REAL_VIDEO = false;

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
            <div className="litt-demo-shell">
              <video
                className="aspect-video w-full rounded-2xl"
                autoPlay
                muted
                loop
                playsInline
                poster={POSTER_SRC}
                controls
                preload="none"
              >
                <source src={VIDEO_MOBILE_SRC} type="video/mp4" media="(max-width: 768px)" />
                <source src={VIDEO_SRC} type="video/mp4" />
              </video>
            </div>
          ) : (
            <div className="litt-video-placeholder">
              <div className="litt-video-placeholder-inner">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#a8ff2f]/24 bg-[#a8ff2f]/8 text-[#a8ff2f] shadow-[0_0_30px_rgba(168,255,47,.12)]">
                    <Play size={28} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-white">Real recording coming soon</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/42">
                      This section is ready for an authentic LiTT session capture.
                      The placeholder shows the exact flow a real recording should demonstrate.
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
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5 font-mono text-[10px] font-black text-[#a8ff2f]">
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

                <div className="mt-6 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-center">
                  <p className="text-[10px] font-bold text-white/30">
                    Required asset: <span className="text-white/50">/demos/litt-real-session.mp4</span> — H.264, 1280×720, 20–45s, muted, with poster image
                  </p>
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
        </div>
      </div>
    </section>
  );
}
