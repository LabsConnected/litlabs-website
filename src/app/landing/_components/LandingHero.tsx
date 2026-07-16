import Link from "next/link";
import { ArrowRight, Check, Play } from "lucide-react";

const CREW = [
  { name: "Director", role: "Plans & coordinates", color: "#a855f7", glyph: "D" },
  { name: "Forge",    role: "Writes & deploys code", color: "#30e7ff", glyph: "F" },
  { name: "Visionary",role: "Designs UI & assets",  color: "#f472b6", glyph: "V" },
  { name: "Research", role: "Finds facts & docs",   color: "#34d399", glyph: "R" },
  { name: "QA Goblin",role: "Tests & verifies",     color: "#f59e0b", glyph: "Q" },
];

const ACTIVITY = [
  { done: true,  text: "Repository connected" },
  { done: true,  text: "Stack detected — Next.js + Supabase" },
  { done: true,  text: "Mobile issues found in hero section" },
  { done: true,  text: "Upgrade plan generated (6 steps)" },
  { done: true,  text: "Plan approved" },
  { done: false, active: true, text: "Rebuilding hero + navigation" },
  { done: false, active: true, text: "Building Studio showcase" },
  { done: false, text: "Responsive checks" },
  { done: false, text: "Generating deployment preview" },
];

const FILES = [
  "src/app/page.tsx",
  "src/components/Hero.tsx",
  "src/components/StudioDemo.tsx",
  "src/styles/landing.css",
];

export function LandingHero() {
  return (
    <section className="relative z-10 px-4 pt-20 pb-16 md:pt-28 md:pb-20">
      {/* ── Headline block ── */}
      <div className="mx-auto max-w-4xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/8 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-orange-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
          </span>
          Beta · Mission active
        </div>

        <p className="mb-3 text-lg font-bold text-neutral-400 md:text-xl">
          Stop chatting.
        </p>
        <h1 className="mb-6 text-4xl font-black leading-[1.03] tracking-tight text-white min-[390px]:text-5xl md:text-7xl lg:text-[5.5rem]">
          Start{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(110deg, #f97316 0%, #a855f7 40%, #30e7ff 80%)",
            }}
          >
            shipping.
          </span>
        </h1>

        <p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-neutral-400 md:text-lg">
          LiTT Labs gives your project an AI crew that can{" "}
          <strong className="text-white">see the work</strong>,{" "}
          <strong className="text-white">change the files</strong>,{" "}
          <strong className="text-white">test the result</strong>, and help
          you ship — all from one command center.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="group inline-flex w-full items-center justify-center gap-2.5 rounded-2xl bg-white px-5 py-3.5 text-sm font-black text-black shadow-[0_0_40px_rgba(255,255,255,0.18)] transition hover:shadow-[0_0_60px_rgba(255,255,255,0.32)] sm:w-auto sm:px-8"
          >
            Launch Studio free
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/studio"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:border-white/20 hover:bg-white/8 sm:w-auto sm:px-7"
          >
            <Play size={13} className="text-orange-300" />
            Watch LiTT build
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-neutral-500">
          {["Free during beta", "No credit card required", "Connect GitHub in seconds"].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <Check size={11} className="text-emerald-400" />
              {t}
            </span>
          ))}
        </div>

        {/* Trusted loop */}
        <div className="mt-8 flex items-center justify-center gap-0 overflow-hidden rounded-xl border border-white/6 bg-white/[0.02]">
          {["Connect", "Plan", "Build", "Verify", "Ship"].map((step, i) => (
            <div key={step} className="flex items-center">
              <span className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${i === 4 ? "text-emerald-300" : i === 2 ? "text-orange-300" : "text-neutral-400"}`}>
                {step}
              </span>
              {i < 4 && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Studio preview card ── */}
      <div className="relative mx-auto mt-16 max-w-6xl">
        {/* Glow halo */}
        <div
          className="pointer-events-none absolute -inset-1 rounded-3xl blur-2xl opacity-50"
          style={{
            background:
              "linear-gradient(135deg, rgba(249,115,22,0.3) 0%, rgba(168,85,247,0.3) 50%, rgba(48,231,255,0.2) 100%)",
          }}
        />

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#09090f] shadow-[0_0_80px_rgba(0,0,0,0.8)]">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d16] px-5 py-3">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/70" />
              <div className="h-3 w-3 rounded-full bg-amber-500/70" />
              <div className="h-3 w-3 rounded-full bg-emerald-500/70" />
            </div>
            <div className="ml-3 flex items-center gap-2 rounded-md bg-white/6 px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
              studio.litlabs.net · Mission active
            </div>
            <div className="ml-auto hidden items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-neutral-600 sm:flex">
              <span className="text-emerald-400">● Live</span>
              <span>Preview</span>
              <span>Deploy</span>
            </div>
          </div>

          <div className="grid min-h-[480px] md:grid-cols-[200px_1fr_220px]">
            {/* Left: crew */}
            <div className="hidden border-r border-white/5 bg-[#0b0b14] p-5 md:block">
              <div className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-neutral-600">
                Project
              </div>
              <div className="mb-4 rounded-lg bg-white/[0.03] border border-white/6 px-3 py-2">
                <div className="text-[11px] font-bold text-white">litlabs-website</div>
                <div className="mt-1 text-[9px] font-mono text-cyan-400">feature/landing-upgrade</div>
              </div>

              <div className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-neutral-600">
                Your AI Crew
              </div>
              <div className="space-y-2">
                {CREW.map((a) => (
                  <div key={a.name} className="flex items-center gap-2.5">
                    <div
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-black"
                      style={{ background: a.color }}
                    >
                      {a.glyph}
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-neutral-200">{a.name}</div>
                      <div className="text-[9px] text-neutral-600">{a.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Center: mission feed */}
            <div className="flex flex-col gap-0 p-5">
              {/* Mission */}
              <div className="mb-4 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
                <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-neutral-600">Mission</div>
                <p className="text-[12px] text-neutral-300 leading-relaxed">
                  Rebuild the landing page with stronger branding, better mobile UX, and a live Studio preview.
                </p>
              </div>

              {/* Activity log */}
              <div className="mb-4 space-y-1.5">
                {ACTIVITY.map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-[11px]">
                    {item.done ? (
                      <span className="text-emerald-400 w-3">✓</span>
                    ) : item.active ? (
                      <span className="w-3 text-orange-400">⟳</span>
                    ) : (
                      <span className="w-3 text-neutral-700">○</span>
                    )}
                    <span
                      className={
                        item.done
                          ? "text-neutral-400"
                          : item.active
                          ? "text-orange-300 font-semibold"
                          : "text-neutral-700"
                      }
                    >
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>

              {/* Composer */}
              <div className="mt-auto flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5">
                <div className="h-5 w-5 rounded-full bg-linear-to-br from-orange-400 to-purple-500 flex items-center justify-center text-[9px] font-black text-white shrink-0">L</div>
                <span className="flex-1 text-[11.5px] text-neutral-500">
                  Ask LiTT to build, fix, design, research, or deploy…
                </span>
                <div className="flex items-center gap-2 text-[9px] text-neutral-700">
                  <span className="cursor-pointer hover:text-neutral-400 transition">Text</span>
                  <span>·</span>
                  <span className="cursor-pointer hover:text-neutral-400 transition">Voice</span>
                  <span>·</span>
                  <span className="cursor-pointer hover:text-neutral-400 transition">Files</span>
                </div>
              </div>
            </div>

            {/* Right: output */}
            <div className="hidden border-l border-white/5 bg-[#0b0b14] p-5 md:block">
              <div className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-neutral-600">
                Live Output
              </div>

              <div className="mb-3 space-y-1.5">
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-1.5 text-[10px] font-bold text-emerald-400">
                  ✓ Plan approved
                </div>
                <div className="rounded-md bg-orange-500/10 border border-orange-500/15 px-2.5 py-1.5 text-[10px] font-bold text-orange-300 flex items-center gap-1.5">
                  <span className="animate-spin">⟳</span> Writing files…
                </div>
              </div>

              <div className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-neutral-600">
                Files changed · 8
              </div>
              <div className="space-y-1">
                {FILES.map((f) => (
                  <div key={f} className="font-mono text-[9px] text-cyan-400 truncate">
                    {f}
                  </div>
                ))}
                <div className="font-mono text-[9px] text-neutral-600">+4 more…</div>
              </div>

              <div className="mt-4 mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-neutral-600">
                Preview
              </div>
              <div className="flex gap-1.5 mb-4">
                {["Desktop", "Mobile"].map((v) => (
                  <span key={v} className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[9px] font-bold text-neutral-400">
                    {v}
                  </span>
                ))}
              </div>

              <div className="space-y-2">
                <button className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold text-neutral-200 transition hover:bg-white/8 text-left">
                  Review Changes
                </button>
                <button className="w-full rounded-lg bg-orange-500/15 border border-orange-500/25 px-3 py-1.5 text-[10px] font-bold text-orange-300 transition hover:bg-orange-500/25 text-left">
                  Approve Mission
                </button>
                <button className="w-full rounded-lg bg-emerald-500/12 border border-emerald-500/20 px-3 py-1.5 text-[10px] font-bold text-emerald-400 transition hover:bg-emerald-500/20 text-left">
                  Deploy Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
