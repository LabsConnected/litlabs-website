import { buildMetadata } from "@/lib/seo";
import { ArrowRight, Bot, Code2, Globe, Heart, Shield, Sparkles, Zap, Check } from "lucide-react";
import Link from "next/link";
import "@/app/public-pages-tlc.css";

export const metadata = buildMetadata({
  title: "About",
  description: "Who we are and what we're building at LiTTree LabStudios.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className="litt-public-light min-h-screen bg-white text-[#0e1510] selection:bg-[#8fd14f]/60">
      {/* ── Hero Section ── */}
      <section className="relative pt-16 pb-20 border-b border-[#cfdec4]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(23,122,54,0.12),transparent_50%)]" />
        <div className="relative mx-auto max-w-screen-xl px-5 lg:px-10">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              About LiTTree LabStudios
            </div>
            <h1 className="text-5xl font-black leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl">
              Building the future of <span className="text-transparent bg-clip-text bg-linear-to-r from-accent to-[#8fd14f]">collaborative building.</span>
            </h1>
            <p className="mt-8 text-xl leading-relaxed text-[#37463a]">
              LiTTree LabStudios is the home of <strong>LiTT</strong>, the AI Project Operator —
              an AI software-building workspace designed to turn ideas into real, ownable projects.
            </p>
          </div>
        </div>
      </section>

      {/* ── Content Sections ── */}
      <section className="py-24 border-b border-[#cfdec4]">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-10">
          <div className="grid gap-16 lg:grid-cols-2">
            <div className="space-y-8">
              <div>
                <h2 className="text-3xl font-black tracking-tight mb-4">What is LiTTree LabStudios?</h2>
                <p className="text-[#37463a] leading-relaxed">
                  LiTTree LabStudios builds LiTT, the AI Project Operator. Unlike simple chat interfaces that forget context or provide generic answers, 
                  LiTT is built for <strong>work</strong>. It preserves project memory, understands architectural constraints, 
                  and operates inside a real development environment.
                </p>
              </div>
              
              <div>
                <h2 className="text-3xl font-black tracking-tight mb-4">Who is LiTT?</h2>
                <p className="text-[#37463a] leading-relaxed">
                  <strong>LiTT</strong> is the AI Project Operator at the center of the platform. LiTT handles the heavy lifting: 
                  writing code, managing project files, running terminal commands, and planning complex missions.
                </p>
              </div>

              <div>
                <h2 className="text-3xl font-black tracking-tight mb-4">Creative, built in</h2>
                <p className="text-[#37463a] leading-relaxed">
                  <strong>LiTT</strong>{" "}handles the creative side too — design direction, image generation, branding, and creative ideation — alongside the engineering. One AI crew, no handoffs.
                </p>
              </div>
            </div>

            <div className="space-y-12">
              <div className="rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-8 shadow-[0_20px_54px_rgba(14,60,26,0.08)]">
                <h3 className="text-xl font-bold flex items-center gap-3 mb-4">
                  <Shield className="text-[#177a36]" size={24} />
                  Trust & Governance
                </h3>
                <p className="text-[#37463a] text-sm leading-relaxed mb-6">
                  We believe AI should be powerful but accountable. Sensitive or destructive actions like 
                  deployments or file deletions always require <strong>human approval</strong>. 
                  You stay in control of your project at every step.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#63745f]">
                    <Check size={14} className="text-accent" />
                    User-owned code and assets
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-[#63745f]">
                    <Check size={14} className="text-accent" />
                    Full data portability and export
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-[#63745f]">
                    <Check size={14} className="text-accent" />
                    No unapproved model training on private data
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#cfdec4] bg-white p-5 shadow-[0_12px_30px_rgba(14,60,26,0.07)]">
                  <Code2 className="text-accent mb-3" size={20} />
                  <div className="text-xs font-black uppercase tracking-wider mb-1">Studio</div>
                  <div className="text-[10px] text-[#63745f]">The primary build environment for real products.</div>
                </div>
                <div className="rounded-xl border border-[#cfdec4] bg-white p-5 shadow-[0_12px_30px_rgba(14,60,26,0.07)]">
                  <Zap className="text-[#177a36] mb-3" size={20} />
                  <div className="text-xs font-black uppercase tracking-wider mb-1">Missions</div>
                  <div className="text-[10px] text-[#63745f]">Structured execution plans with clear outcomes.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Beta Section ── */}
      <section className="py-24 bg-[#f2f7ea]">
        <div className="mx-auto max-w-screen-xl px-5 lg:px-10 text-center">
          <h2 className="text-3xl font-black mb-6">Current Beta Status</h2>
          <p className="max-w-2xl mx-auto text-[#63745f] mb-12">
            LiTTree is evolving rapidly. While core building and media tools are ready for use, 
            features like file checkpoints and publishing are currently in beta. Publishing puts your 
            project live at its own LiTTLabs-managed URL when you approve it — nothing ships without you saying so.
          </p>
          <div className="inline-flex flex-wrap justify-center gap-3">
            {[
              { label: "Core Chat", status: "Live" },
              { label: "Project Memory", status: "Live" },
              { label: "Terminal Access", status: "Live" },
              { label: "Visual Canvas", status: "Live" },
              { label: "Image Forge", status: "Live" },
              { label: "Audio & Music", status: "Live" },
              { label: "File Checkpoints", status: "Beta" },
              { label: "Publishing", status: "Beta" },
            ].map(feature => (
              <span key={feature.label} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#cfdec4] bg-white text-xs font-bold text-[#37463a] shadow-[0_8px_22px_rgba(14,60,26,0.06)]">
                <span className={`h-1.5 w-1.5 rounded-full ${feature.status === "Live" ? "bg-[#8fd14f]" : "bg-[#e8a317]"}`} />
                {feature.label}
                <span className="text-[10px] font-black uppercase tracking-wider text-[#63745f]">{feature.status}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[#0b120d] border-t border-white/10 px-5 py-12 lg:px-10 mt-auto">
        <div className="mx-auto max-w-screen-2xl">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2 font-black text-white">
              <Sparkles size={16} className="text-accent" /> LiTTree LabStudios
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
