import Link from "next/link";
import { ArrowRight, Rocket, Sparkles } from "lucide-react";

export function LandingCTA() {
  return (
    <section className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-5xl">
        <div
          className="relative overflow-hidden rounded-3xl border border-purple-500/20 px-8 py-16 text-center md:px-16 md:py-20"
          style={{
            background:
              "linear-gradient(145deg, rgba(168,85,247,0.08), rgba(48,231,255,0.04) 50%, transparent), rgba(10,10,20,0.95)",
          }}
        >
          {/* Glows */}
          <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-purple-500/20 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-cyan-500/15 blur-[100px]" />
          <div
            className="absolute left-0 top-0 h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(168,85,247,0.6) 40%, rgba(48,231,255,0.4) 70%, transparent)",
            }}
          />

          {/* Grid pattern */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-3xl"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage:
                "radial-gradient(ellipse at 50% 50%, black 30%, transparent 80%)",
              WebkitMaskImage:
                "radial-gradient(ellipse at 50% 50%, black 30%, transparent 80%)",
            }}
          />

          <div className="relative">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-300">
              <Sparkles size={11} className="text-orange-300" />
              Beta · Free to start
            </div>

            <p className="mb-2 text-lg font-semibold text-neutral-400">
              Your project already has the files.
            </p>
            <h2 className="mb-5 text-4xl font-black leading-[1.06] tracking-tight text-white md:text-6xl">
              Now give it a{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(110deg, #a855f7 0%, #30e7ff 100%)",
                }}
              >
                crew.
              </span>
            </h2>

            <p className="mx-auto mb-10 max-w-lg text-base text-neutral-400">
              Connect your first project, assign a mission, and watch LiTT turn
              direction into verified, deployable work.
            </p>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="group inline-flex items-center gap-2.5 rounded-2xl bg-white px-8 py-4 text-sm font-black text-black shadow-[0_0_50px_rgba(255,255,255,0.25)] transition hover:scale-[1.02] hover:shadow-[0_0_70px_rgba(255,255,255,0.4)]"
              >
                <Rocket size={15} />
                Launch Studio free
                <ArrowRight
                  size={13}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-sm font-semibold text-white backdrop-blur-md transition hover:border-white/25 hover:bg-white/8"
              >
                Explore the product
              </Link>
            </div>

            <p className="mt-6 text-xs text-neutral-600">
              Free during beta · No credit card required · Self-host with Docker
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-6 border-t border-white/5 pt-8 text-xs text-neutral-500">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Platform live &amp; stable
              </span>
              <span className="hidden text-neutral-700 sm:inline">·</span>
              <span>1,200+ creators building</span>
              <span className="hidden text-neutral-700 sm:inline">·</span>
              <span>Built with LiTT 🌳</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
