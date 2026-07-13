import Link from "next/link";
import { Sparkles, ArrowRight, Rocket, BookOpen } from "lucide-react";

export function LandingCTA() {
  return (
    <section className="relative z-10 px-6 py-24 md:py-32">
      <div className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/8 via-fuchsia-500/5 to-amber-400/8 p-10 text-center shadow-[0_0_80px_rgba(168,85,247,0.15)] md:p-16">
          {/* glow accents */}
          <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-[100px]" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-[100px]" />

          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-200">
              <Sparkles size={11} className="text-amber-300" />
              Beta · Free to start
            </div>

            <h2 className="mb-4 text-4xl font-black tracking-tight text-white md:text-6xl">
              Ready to ship with
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(110deg, #22d3ee 0%, #a855f7 50%, #fbbf24 100%)",
                }}
              >
                your AI crew?
              </span>
            </h2>

            <p className="mx-auto mb-10 max-w-xl text-base text-neutral-300">
              Connect your first project in Studio. Your crew is standing by,
              and so are we.
            </p>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="group inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-sm font-black text-black shadow-[0_0_40px_rgba(255,255,255,0.25)] transition hover:shadow-[0_0_60px_rgba(255,255,255,0.4)]"
              >
                <Rocket size={16} />
                Get started free
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-8 py-4 text-sm font-semibold text-white backdrop-blur-md transition hover:border-white/25 hover:bg-white/10"
              >
                <BookOpen size={14} className="text-cyan-300" />
                Read the docs
              </Link>
            </div>

            <p className="mt-6 text-xs text-neutral-500">
              No credit card · Cancel anytime · Self-host with Docker
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
