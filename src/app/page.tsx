"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import {
  Bot,
  ArrowRight,
  Sparkles,
  Shield,
  GitBranch,
  Cloud,
  Zap,
  Terminal,
  Image as ImageIcon,
  Cpu,
} from "lucide-react";

const STEPS = [
  {
    step: "01",
    title: "Connect a project",
    desc: "Link GitHub, pick a repo, and define the outcome you want.",
    color: "#22d3ee",
  },
  {
    step: "02",
    title: "Direct your crew",
    desc: "Describe the work. LiTT Director plans the steps, assigns tools, and asks before acting.",
    color: "#a855f7",
  },
  {
    step: "03",
    title: "Review and ship",
    desc: "Preview changes, approve diffs, verify the result, and deploy or open a PR.",
    color: "#22c55e",
  },
];

const INTEGRATIONS = [
  { name: "GitHub", icon: GitBranch, color: "#e2e8f0" },
  { name: "Supabase", icon: Cloud, color: "#3ecf8e" },
  { name: "Vercel", icon: Zap, color: "#ffffff" },
  { name: "Clerk", icon: Shield, color: "#6c47ff" },
];

const CAPABILITIES = [
  { text: "Conversational project director", icon: Cpu },
  { text: "Multi-agent task routing", icon: Bot },
  { text: "Image, audio, and code generation", icon: ImageIcon },
  { text: "Live diff preview and approval", icon: GitBranch },
  { text: "Deployment status and build logs", icon: Terminal },
  { text: "Artifact museum and version history", icon: Sparkles },
];

const PREVIEW_MESSAGES = [
  { role: "user", text: "Build a landing page for LiTT Labs." },
  {
    role: "director",
    text: "Got it. I'll scaffold the hero, features, and CTA sections. Reviewing your repo first...",
  },
  { role: "tool", text: "✓ Scanned 12 files · Plan ready · Awaiting approval" },
];

function PublicHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#06060e]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-black text-white"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-cyan-400 to-fuchsia-500">
            <Bot size={14} className="text-black" />
          </div>
          LiTT Labs
        </Link>
        <nav className="hidden items-center gap-6 text-xs font-medium text-neutral-400 md:flex">
          <Link href="/studio" className="transition hover:text-cyan-300">
            Product
          </Link>
          <Link href="/agents" className="transition hover:text-cyan-300">
            Agents
          </Link>
          <Link href="/marketplace" className="transition hover:text-cyan-300">
            Marketplace
          </Link>
          <Link href="/docs" className="transition hover:text-cyan-300">
            Docs
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden px-3 py-1.5 text-xs font-semibold text-neutral-400 transition hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-cyan-500 to-cyan-400 px-3 py-1.5 text-xs font-bold text-black shadow-[0_0_16px_rgba(34,211,238,0.4)] transition hover:shadow-[0_0_24px_rgba(34,211,238,0.6)]"
          >
            Start building <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#06060e] text-[#e2e2e9]">
      <PublicHeader />

      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-cyan-500/8 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[400px] w-[400px] rounded-full bg-fuchsia-500/8 blur-[120px]" />
        <div className="absolute bottom-1/4 -left-40 h-[400px] w-[400px] rounded-full bg-purple-500/8 blur-[120px]" />
      </div>

      {/* Hero */}
      <section className="relative z-10 px-4 pb-20 pt-32 md:pt-44">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
            <Sparkles size={10} />
            AI operating system for builders
          </div>

          <h1 className="mb-6 text-4xl font-black leading-[1.1] tracking-tight text-white md:text-6xl lg:text-7xl">
            Build, verify, and ship{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #22d3ee 0%, #a855f7 50%, #ec4899 100%)",
              }}
            >
              real digital products
            </span>
            <br />
            with an AI crew.
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-neutral-400 md:text-lg">
            LiTT Labs is a control tower where you connect a project, direct an
            AI team, review actual changes, and deploy — instead of chatting
            into the void.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-cyan-500 to-cyan-400 px-7 py-3.5 text-sm font-black text-black shadow-[0_0_32px_rgba(34,211,238,0.35)] transition hover:shadow-[0_0_48px_rgba(34,211,238,0.5)]"
            >
              Start building free <ArrowRight size={16} />
            </Link>
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:border-white/20 hover:bg-white/8"
            >
              <Terminal size={14} className="text-cyan-400" />
              Open Studio
            </Link>
          </div>

          <div className="mt-8 text-[11px] text-neutral-600">
            Free during beta · No credit card required
          </div>
        </div>
      </section>

      {/* Product preview */}
      <section className="relative z-10 px-4 pb-20">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a14] shadow-[0_0_80px_rgba(34,211,238,0.06),0_0_0_1px_rgba(255,255,255,0.04)]">
            {/* Window chrome */}
            <div className="flex items-center gap-2 border-b border-white/6 bg-white/2 px-4 py-2.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
              <div className="ml-3 flex items-center gap-1.5 rounded-md bg-white/4 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-cyan-400">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                LiTT Studio — Mission Active
              </div>
            </div>

            <div className="grid min-h-[360px] md:grid-cols-[200px_1fr_180px]">
              {/* Left sidebar */}
              <div className="hidden border-r border-white/6 p-4 md:block">
                <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-neutral-500">
                  Project
                </div>
                <div className="space-y-2">
                  {["litlabs-website", "api-routes", "components"].map(
                    (f, i) => (
                      <div
                        key={f}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-medium ${i === 0 ? "bg-cyan-500/10 text-cyan-300" : "text-neutral-500"}`}
                      >
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${i === 0 ? "bg-cyan-400" : "bg-neutral-700"}`}
                        />
                        {f}
                      </div>
                    ),
                  )}
                </div>
                <div className="mt-4 mb-2 text-[9px] font-black uppercase tracking-widest text-neutral-500">
                  Agents
                </div>
                <div className="space-y-1.5">
                  {["Director", "Visionary", "Builder"].map((a) => (
                    <div
                      key={a}
                      className="flex items-center gap-2 text-[10px] text-neutral-500"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                      {a}
                    </div>
                  ))}
                </div>
              </div>

              {/* Main chat */}
              <div className="flex flex-col justify-end space-y-3 p-5">
                {PREVIEW_MESSAGES.map((m, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}
                  >
                    {m.role !== "user" && (
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black ${m.role === "director" ? "bg-cyan-500/20 text-cyan-300" : "bg-amber-500/20 text-amber-300"}`}
                      >
                        {m.role === "director" ? "L" : "✓"}
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${m.role === "user" ? "bg-cyan-500/15 text-cyan-100" : m.role === "tool" ? "border border-green-500/20 bg-green-500/5 font-mono text-green-400" : "bg-white/5 text-neutral-300"}`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3 py-2">
                  <span className="flex-1 text-[11px] text-neutral-500">
                    Ask LiTT to build, fix, or create...
                  </span>
                  <div className="rounded-lg bg-cyan-500/20 p-1.5">
                    <ArrowRight size={10} className="text-cyan-400" />
                  </div>
                </div>
              </div>

              {/* Right panel */}
              <div className="hidden border-l border-white/6 p-4 md:block">
                <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-neutral-500">
                  Output
                </div>
                <div className="space-y-2">
                  <div className="rounded-lg bg-green-500/10 px-2 py-1.5 text-[9px] font-bold text-green-400">
                    ✓ Plan approved
                  </div>
                  <div className="rounded-lg bg-cyan-500/10 px-2 py-1.5 text-[9px] font-bold text-cyan-400">
                    ⟳ Writing files…
                  </div>
                  <div className="h-2 w-4/5 rounded bg-white/5" />
                  <div className="h-2 w-3/5 rounded bg-white/5" />
                </div>
                <div className="mt-4 mb-2 text-[9px] font-black uppercase tracking-widest text-neutral-500">
                  Deploy
                </div>
                <div className="rounded-lg border border-white/8 bg-white/3 px-2 py-2 text-[9px] text-neutral-500">
                  Vercel · main · 2s ago
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 border-t border-white/5 px-4 py-20 md:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              The loop
            </div>
            <h2 className="text-2xl font-black text-white md:text-3xl">
              How it works
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              One loop from idea to shipped product.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.step}
                className="group relative overflow-hidden rounded-2xl border border-white/6 bg-white/2 p-6 transition hover:border-white/12"
                style={{ boxShadow: `0 0 40px ${s.color}08` }}
              >
                <div
                  className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    background: `radial-gradient(circle at 0% 0%, ${s.color}08 0%, transparent 60%)`,
                  }}
                />
                <div
                  className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl text-xs font-black"
                  style={{ backgroundColor: `${s.color}15`, color: s.color }}
                >
                  {s.step}
                </div>
                <h3 className="mb-2 text-sm font-black text-white">
                  {s.title}
                </h3>
                <p className="text-xs leading-relaxed text-neutral-500">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="relative z-10 border-t border-white/5 px-4 py-20 md:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-12 md:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Capabilities
              </div>
              <h2 className="text-2xl font-black text-white md:text-3xl">
                Everything in one OS.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-neutral-500">
                One workspace. Every tool your project needs — code, visuals,
                deployments, agents, memory.
              </p>
              <Link
                href="/studio"
                className="mt-6 inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/12"
              >
                See it live <ArrowRight size={12} />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {CAPABILITIES.map(({ text, icon: Icon }) => (
                <div
                  key={text}
                  className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/2 p-3 transition hover:border-cyan-500/15"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                    <Icon size={13} className="text-cyan-400" />
                  </div>
                  <span className="text-xs leading-snug text-neutral-300">
                    {text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="relative z-10 border-t border-white/5 px-4 py-16">
        <div className="mx-auto max-w-5xl text-center">
          <div className="mb-6 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
            Connects to the stack you already use
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {INTEGRATIONS.map((i) => (
              <div
                key={i.name}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-4 py-2.5 text-xs font-semibold text-neutral-300 backdrop-blur-sm transition hover:border-white/15"
              >
                <i.icon size={13} style={{ color: i.color }} />
                {i.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="relative z-10 border-t border-white/5 px-4 py-20">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-cyan-500/15 bg-linear-to-br from-cyan-500/5 via-transparent to-fuchsia-500/5 p-10 text-center shadow-[0_0_80px_rgba(34,211,238,0.08)] md:p-14">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/8 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
            <Sparkles size={9} /> Beta · Free to start
          </div>
          <h2 className="mb-3 text-2xl font-black text-white md:text-3xl">
            Ready to ship with your AI crew?
          </h2>
          <p className="mb-8 text-sm text-neutral-500">
            Connect your first project in Studio. Your AI crew is standing by.
          </p>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-r from-cyan-500 to-cyan-400 px-8 py-3.5 text-sm font-black text-black shadow-[0_0_32px_rgba(34,211,238,0.4)] transition hover:shadow-[0_0_48px_rgba(34,211,238,0.6)]"
          >
            Get started free <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-neutral-600 md:flex-row">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-linear-to-br from-cyan-400 to-fuchsia-500">
              <Bot size={11} className="text-black" />
            </div>
            LiTT Labs
          </div>
          <div className="flex items-center gap-6">
            <Link href="/docs" className="transition hover:text-white">
              Docs
            </Link>
            <Link href="/privacy" className="transition hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="transition hover:text-white">
              Terms
            </Link>
          </div>
          <div>© {new Date().getFullYear()} LiTTree Labs. Beta.</div>
        </div>
      </footer>
    </div>
  );
}

export default function HomePage() {
  const { isSignedIn: clerkSignedIn, isLoaded: clerkLoaded } =
    useClerkAuth();
  const { isSignedIn: supabaseSignedIn, loading: supabaseLoading } =
    useSupabaseAuthHook();
  const router = useRouter();

  useEffect(() => {
    if (!clerkLoaded || supabaseLoading) return;

    if (clerkSignedIn || supabaseSignedIn) {
      router.replace("/studio");
    }
  }, [clerkSignedIn, supabaseSignedIn, clerkLoaded, supabaseLoading, router]);

  return <LandingPage />;
}
