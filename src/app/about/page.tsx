import { buildMetadata } from "@/lib/seo";
import { ArrowRight, Bot, Code2, Globe, Heart, Shield, Sparkles, Zap, Check } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export const metadata = buildMetadata({
  title: "About",
  description: "Who we are and what we're building at LiTTree LabStudios.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#03050a] text-white selection:bg-[#a970ff]">
      {/* ── Header ── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-[#03050a]/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-5 lg:px-10">
          <Link href="/" className="flex items-center gap-2.5 font-black tracking-tight text-white">
            <span className="relative h-9 w-9 overflow-hidden rounded-xl border border-[#a8ff2f]/30 shadow-[0_0_25px_rgba(168,255,47,.18)]">
              <Image src="/brand/litt-mascot-avatar.png" alt="LiTT" fill sizes="36px" className="object-cover" />
            </span>
            <span className="hidden sm:inline">LiTTree LabStudios</span>
            <span className="sm:hidden">LiTTree</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-white/60 md:flex">
            <Link href="/" className="transition hover:text-[#a8ff2f]">Home</Link>
            <Link href="/studio" className="transition hover:text-[#a8ff2f]">Studio</Link>
            <Link href="/pricing" className="transition hover:text-[#a8ff2f]">Pricing</Link>
          </nav>
          <div className="flex items-center gap-4">
             <Link href="/sign-up" className="rounded-full bg-linear-to-r from-[#a8ff2f] to-[#62f6c4] px-4 py-2 text-sm font-black text-[#03050a] transition hover:scale-[1.03]">
              Start building
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="relative pt-32 pb-20 border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(168,112,255,0.08),transparent_50%)]" />
        <div className="relative mx-auto max-w-screen-xl px-5 lg:px-10">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/20 bg-[#a8ff2f]/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-[#a8ff2f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" />
              The Authority on AI Creation
            </div>
            <h1 className="text-5xl font-black leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl">
              Building the future of <span className="text-transparent bg-clip-text bg-linear-to-r from-[#a8ff2f] to-[#65f4ff]">collaborative building.</span>
            </h1>
            <p className="mt-8 text-xl leading-relaxed text-white/60">
              LiTTree LabStudios is the home of <strong>LiTTree</strong> (also known as <strong>LitLabs</strong>), 
              an AI creative platform designed to turn ideas into working products and creative media.
            </p>
          </div>
        </div>
      </section>

      {/* ── Content Sections ── */}
      <section className="py-24 border-b border-white/8">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-10">
          <div className="grid gap-16 lg:grid-cols-2">
            <div className="space-y-8">
              <div>
                <h2 className="text-3xl font-black tracking-tight mb-4">What is LiTTree?</h2>
                <p className="text-white/60 leading-relaxed">
                  LiTTree is an AI-powered creative operating system. Unlike simple chat interfaces that forget context or provide generic answers, 
                  LiTTree is built for <strong>work</strong>. It preserves project memory, understands architectural constraints, 
                  and operates inside a real development environment.
                </p>
              </div>
              
              <div>
                <h2 className="text-3xl font-black tracking-tight mb-4">Who is LiTT?</h2>
                <p className="text-white/60 leading-relaxed">
                  <strong>LiTT</strong> is the core AI engineering and execution brain of the platform. LiTT handles the heavy lifting: 
                  writing code, managing project files, running terminal commands, and planning complex missions.
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-black tracking-tight mb-4">Meet Spark</h2>
                <p className="text-white/60 leading-relaxed">
                  <strong>Spark</strong> is LiTT&apos;s creative companion. While LiTT focuses on engineering and logic, 
                  Spark handles design direction, image generation, branding, and creative ideation. Together, they form your AI building crew.
                </p>
              </div>
            </div>

            <div className="space-y-12">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
                <h3 className="text-xl font-bold flex items-center gap-3 mb-4">
                  <Shield className="text-[#65f4ff]" size={24} />
                  Trust & Governance
                </h3>
                <p className="text-white/60 text-sm leading-relaxed mb-6">
                  We believe AI should be powerful but accountable. Sensitive or destructive actions like 
                  deployments or file deletions always require <strong>human approval</strong>. 
                  You stay in control of your project at every step.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-white/50">
                    <Check size={14} className="text-[#a8ff2f]" />
                    User-owned code and assets
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-white/50">
                    <Check size={14} className="text-[#a8ff2f]" />
                    Full data portability and export
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-white/50">
                    <Check size={14} className="text-[#a8ff2f]" />
                    No unapproved model training on private data
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/8 bg-black/40 p-5">
                  <Code2 className="text-[#a8ff2f] mb-3" size={20} />
                  <div className="text-xs font-black uppercase tracking-wider mb-1">Studio</div>
                  <div className="text-[10px] text-white/40">The primary build environment for real products.</div>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/40 p-5">
                  <Zap className="text-[#b58cff] mb-3" size={20} />
                  <div className="text-xs font-black uppercase tracking-wider mb-1">Missions</div>
                  <div className="text-[10px] text-white/40">Structured execution plans with clear outcomes.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Beta Section ── */}
      <section className="py-24 bg-white/[0.02]">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-10 text-center">
          <h2 className="text-3xl font-black mb-6">Current Beta Status</h2>
          <p className="max-w-2xl mx-auto text-white/50 mb-12">
            LiTTree is evolving rapidly. While core building and media tools are ready for use, 
            features like file checkpoints and one-click global deployment are currently in beta.
          </p>
          <div className="inline-flex flex-wrap justify-center gap-3">
            {["Core Chat", "Project Memory", "Terminal Access", "Visual Canvas", "Image Forge", "Audio & Music"].map(feature => (
              <span key={feature} className="px-4 py-2 rounded-full border border-white/10 bg-white/5 text-xs font-bold text-white/70">
                {feature}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[#050706] border-t border-white/5 px-5 py-12 lg:px-10 mt-auto">
        <div className="mx-auto max-w-screen-2xl">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2 font-black text-white">
              <Sparkles size={16} className="text-[#a8ff2f]" /> LiTTree LabStudios
            </div>
            <div className="flex flex-wrap justify-center gap-6 text-xs font-bold text-white/40">
              <Link href="/" className="hover:text-white transition">Home</Link>
              <Link href="/studio" className="hover:text-white transition">Studio</Link>
              <Link href="/pricing" className="hover:text-white transition">Pricing</Link>
              <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
              <Link href="/terms" className="hover:text-white transition">Terms</Link>
            </div>
          </div>
          <div className="mt-8 text-center text-[10px] text-white/20">
            &copy; {new Date().getFullYear()} LiTTree LabStudios. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
