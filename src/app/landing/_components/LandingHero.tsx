import Link from "next/link";
import { ArrowRight, Sparkles, Rocket, Play, Check, Star } from "lucide-react";

const HIGHLIGHTS = [
  "No credit card required",
  "Free during open beta",
  "Self-host via Docker",
  "Open source core",
];

const SIDEBAR_ITEMS = [
  "Creator Pro",
  "LitLabs Site",
  "Agent Roster",
  "Marketplace",
];

const AGENTS = ["Director", "Builder", "Visionary", "Critic"];

export function LandingHero() {
  return (
    <section className="relative z-10 px-6 pt-20 pb-24 md:pt-28 md:pb-32">
      <div className="mx-auto max-w-5xl text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
          </span>
          v1.0 · Studio is live
        </div>

        <h1 className="mb-6 text-5xl font-black leading-[1.05] tracking-tight text-white md:text-7xl lg:text-[5.5rem]">
          Build, automate, and ship
          <br />
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(110deg, #22d3ee 0%, #a855f7 45%, #f472b6 75%, #fbbf24 100%)",
            }}
          >
            with your AI crew.
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-neutral-400 md:text-lg">
          LiTTree-LabStudios is a creator operating system where AI agents,
          visual tools, and a real production stack meet. Stop chatting into the
          void — start shipping real artifacts.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-white px-7 py-3.5 text-sm font-black text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition hover:shadow-[0_0_60px_rgba(255,255,255,0.3)]"
          >
            <Rocket size={16} />
            Start building free
            <ArrowRight
              size={14}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:border-white/20 hover:bg-white/10"
          >
            <Play size={13} className="text-cyan-300" />
            Watch demo
          </Link>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-neutral-500">
          {HIGHLIGHTS.map((h) => (
            <span key={h} className="flex items-center gap-1.5">
              <Check size={11} className="text-emerald-400" />
              {h}
            </span>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-center gap-3 text-xs text-neutral-500 sm:flex-row sm:gap-5">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                size={13}
                className="fill-amber-400 text-amber-400"
              />
            ))}
            <span className="ml-2 font-mono text-neutral-400">4.9</span>
            <span>· 1,200+ creators</span>
          </div>
          <span className="hidden text-neutral-700 sm:inline">·</span>
          <span>
            Trusted by indie founders, agencies, and creator-ops teams
          </span>
        </div>
      </div>

      {/* Hero preview card */}
      <div className="relative mx-auto mt-20 max-w-6xl">
        <div className="absolute -inset-px rounded-3xl bg-gradient-to-r from-cyan-500/40 via-fuchsia-500/40 to-amber-400/40 opacity-50 blur-2xl" />
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a14] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-5 py-3">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/70" />
              <div className="h-3 w-3 rounded-full bg-amber-500/70" />
              <div className="h-3 w-3 rounded-full bg-emerald-500/70" />
            </div>
            <div className="ml-3 flex items-center gap-2 rounded-md bg-white/5 px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              studio.litlabs.net
            </div>
            <div className="ml-auto hidden items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 sm:flex">
              <span>Build</span>
              <span className="text-neutral-700">·</span>
              <span>Plan</span>
              <span className="text-neutral-700">·</span>
              <span>Ship</span>
            </div>
          </div>

          <div className="grid min-h-[420px] md:grid-cols-[220px_1fr_220px]">
            <div className="hidden border-r border-white/5 p-5 md:block">
              <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-neutral-500">
                Workspace
              </div>
              <div className="space-y-1.5">
                {SIDEBAR_ITEMS.map((f, i) => (
                  <div
                    key={f}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                      i === 0
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "text-neutral-500"
                    }`}
                  >
                    <div
                      className={`h-1.5 w-1.5 rounded-full ${
                        i === 0 ? "bg-cyan-400" : "bg-neutral-700"
                      }`}
                    />
                    {f}
                  </div>
                ))}
              </div>
              <div className="mt-5 mb-2 text-[10px] font-black uppercase tracking-widest text-neutral-500">
                Agents
              </div>
              <div className="space-y-1.5">
                {AGENTS.map((a) => (
                  <div
                    key={a}
                    className="flex items-center gap-2 text-[11px] text-neutral-400"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {a}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 p-6">
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-[10px] font-black text-cyan-300">
                  U
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-cyan-500/10 px-4 py-2.5 text-[12.5px] text-cyan-50">
                  Build a modern landing page with hero, features grid, and CTA
                  button.
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-[10px] font-black text-white">
                  L
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white/[0.04] px-4 py-2.5 text-[12.5px] text-neutral-200">
                  Got it. Planning hero, 8-card features grid, stats strip, and
                  a final CTA. Scanning your stack and writing files…
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-black text-emerald-300">
                  ✓
                </div>
                <div className="flex-1 rounded-2xl rounded-tl-sm border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 font-mono text-[11.5px] text-emerald-300">
                  ✓ Plan ready · 6 files · awaiting approval
                </div>
              </div>

              <div className="mt-auto flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <Sparkles size={13} className="text-cyan-400" />
                <span className="flex-1 text-[12px] text-neutral-500">
                  Ask your crew to build, fix, or design anything…
                </span>
                <div className="rounded-md bg-white/10 p-1.5">
                  <ArrowRight size={11} className="text-white" />
                </div>
              </div>
            </div>

            <div className="hidden border-l border-white/5 p-5 md:block">
              <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-neutral-500">
                Output
              </div>
              <div className="space-y-1.5">
                <div className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-[10px] font-bold text-emerald-400">
                  ✓ Plan approved
                </div>
                <div className="rounded-md bg-cyan-500/10 px-2 py-1.5 text-[10px] font-bold text-cyan-300">
                  ⟳ Writing files…
                </div>
                <div className="h-1.5 w-4/5 rounded-full bg-white/5" />
                <div className="h-1.5 w-3/5 rounded-full bg-white/5" />
                <div className="h-1.5 w-2/3 rounded-full bg-white/5" />
              </div>
              <div className="mt-5 mb-2 text-[10px] font-black uppercase tracking-widest text-neutral-500">
                Deploy
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10px] text-neutral-400">
                <div className="font-mono text-emerald-400">● live</div>
                <div>Vercel · main</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
