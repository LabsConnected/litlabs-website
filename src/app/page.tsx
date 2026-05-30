"use client";
import Link from "next/link";
import Navbar from "@/components/Navbar";

export default function Home() {
  return (
    <div className="min-h-screen bg-cyber-bg selection:bg-neon-cyan/30">
      <Navbar />

      {/* ========== HERO ========== */}
      <section className="relative overflow-hidden px-6 pt-20 pb-16 sm:pt-28 sm:pb-28 lg:pt-36 lg:pb-40">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[400px] w-[400px] sm:h-[500px] sm:w-[500px] rounded-full bg-neon-cyan/10 blur-[120px] animate-pulse" />
        </div>
        <div className="pointer-events-none absolute top-1/4 -right-20">
          <div className="h-[300px] w-[300px] sm:h-[400px] sm:w-[400px] rounded-full bg-neon-purple/5 blur-[100px]" />
        </div>

        <div className="relative mx-auto max-w-5xl text-center">
          <div className="mb-6 sm:mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 sm:px-4 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-text-secondary backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400 shadow-[0_0_8px_#4ade80]" />
            </span>
            CEO_NODE_ONLINE // litlabs.net
          </div>

          <h1 className="mb-6 sm:mb-8 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl lg:text-8xl font-heading">
            BUILD THE <span className="gradient-text drop-shadow-[0_0_30px_rgba(0,242,254,0.2)]">FUTURE</span>
            <br />WITH AI AGENTS
          </h1>

          <p className="mx-auto mb-8 sm:mb-12 max-w-2xl text-sm sm:text-lg lg:text-xl text-text-secondary leading-relaxed font-medium">
            Your limitless digital hub. Build, automate, and scale using custom daemons and dual-agent orchestration — all from the CEO Operating System.
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link href="/login" className="btn-primary w-full sm:w-auto text-sm sm:text-base px-8 py-4 min-h-[48px] uppercase tracking-wider">
              Start Building →
            </Link>
            <Link href="/gallery" className="btn-secondary w-full sm:w-auto text-sm sm:text-base px-8 py-4 min-h-[48px] uppercase tracking-wider">
              Explore Agents
            </Link>
          </div>
        </div>
      </section>

      {/* ========== STATS ========== */}
      <section className="border-y border-white/5 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto grid max-w-6xl grid-cols-2 sm:grid-cols-4">
          {[
            { value: "6+", label: "ACTIVE DAEMONS" },
            { value: "∞", label: "NEURAL LINKS" },
            { value: "100%", label: "OPEN ACCESS" },
            { value: "24/7", label: "ALWAYS ONLINE" },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`bg-cyber-bg py-8 sm:py-10 px-4 text-center group hover:bg-white/[0.02] transition-colors ${
                i < 2 ? "border-b border-white/5 sm:border-b-0" : ""
              } ${i % 2 === 0 ? "border-r border-white/5 sm:border-r-0" : ""}`}
            >
              <div className="text-2xl sm:text-4xl font-bold text-neon-cyan text-glow-cyan mb-1 sm:mb-2 font-heading">{s.value}</div>
              <div className="text-[9px] sm:text-[10px] font-bold tracking-[0.2em] text-text-muted uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section id="features" className="px-6 py-20 sm:py-28 lg:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 sm:mb-20 text-center">
            <h2 className="mb-4 sm:mb-6 text-2xl sm:text-4xl lg:text-5xl font-bold font-heading">
              SYSTEM <span className="gradient-text">CAPABILITIES</span>
            </h2>
            <p className="mx-auto max-w-xl text-sm sm:text-base text-text-secondary font-medium">
              From autonomous chat to dual-agent orchestration — managed through your CEO OPERATING SYSTEM.
            </p>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "⚡", title: "Neural Chat", desc: "Direct link to pre-built agents for coding, writing, and analysis — each with a unique cyber-persona." },
              { icon: "🔧", title: "Forge Agent", desc: "No-code foundry to create custom AI daemons. Define behavior, set skills, and deploy instantly." },
              { icon: "🏆", title: "Agent Arena", desc: "Enter your custom build in head-to-head challenges. Climb the global reputation matrix." },
              { icon: "🏛", title: "Champion Gallery", desc: "Browse and deploy top-rated agents from the community. Forge your own legacy." },
              { icon: "👥", title: "The Matrix", desc: "Connect with other builders in the social hub. Share logs, wins, and technical breakthroughs." },
              { icon: "🔌", title: "Deep Link", desc: "Connect your AI to Discord, Telegram, and more. Your daemons work across the entire web." },
            ].map((f) => (
              <div key={f.title} className="card group hover:border-neon-cyan/50 p-5 sm:p-6">
                <div className="mb-3 sm:mb-4 text-3xl sm:text-4xl group-hover:scale-110 transition-transform duration-300">{f.icon}</div>
                <h3 className="mb-2 text-lg sm:text-xl font-bold group-hover:text-neon-cyan transition-colors font-heading tracking-tight">
                  {f.title}
                </h3>
                <p className="text-xs sm:text-sm text-text-secondary leading-relaxed font-medium">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section id="pricing" className="px-6 py-20 sm:py-28 lg:py-32 relative overflow-hidden">
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-[500px] w-[500px] rounded-full bg-neon-cyan/5 blur-[150px]" />
        </div>

        <div className="mx-auto max-w-6xl relative">
          <div className="mb-12 sm:mb-16 text-center">
            <span className="badge badge-cyan mb-4 sm:mb-6">PRICING</span>
            <h2 className="mb-4 sm:mb-6 text-2xl sm:text-4xl lg:text-5xl font-bold font-heading">
              CHOOSE YOUR <span className="gradient-text">TIER</span>
            </h2>
            <p className="mx-auto max-w-lg text-sm sm:text-base text-text-secondary font-medium">
              From free exploration to enterprise-scale orchestration — pick the level that matches your ambition.
            </p>
          </div>

          <div className="grid gap-6 sm:gap-8 lg:grid-cols-3 items-start">
            {/* Free Tier */}
            <div className="card p-6 sm:p-8 flex flex-col h-full">
              <span className="badge badge-green mb-4 self-start">STARTER</span>
              <h3 className="text-xl sm:text-2xl font-bold font-heading mb-2">Explorer</h3>
              <p className="text-xs sm:text-sm text-text-secondary mb-6 font-medium">Perfect for getting started with AI agents.</p>
              <div className="mb-6">
                <span className="text-4xl sm:text-5xl font-extrabold font-heading">$0</span>
                <span className="text-sm text-text-muted ml-1">/forever</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {["3 Active Agents", "Basic Neural Chat", "Community Access", "1Gb Storage"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-text-secondary">
                    <span className="text-green-400 flex-shrink-0">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className="btn-secondary w-full py-4 min-h-[48px] uppercase tracking-wider text-sm text-center">
                Get Started Free
              </Link>
            </div>

            {/* Pro Tier - HIGHLIGHTED */}
            <div className="card p-6 sm:p-8 flex flex-col h-full relative border-neon-cyan/50 hover:border-neon-cyan/70 shadow-[0_0_30px_rgba(0,242,254,0.08)] hover:shadow-[0_0_40px_rgba(0,242,254,0.15)] order-first lg:order-none">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="inline-block rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple px-4 py-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-black whitespace-nowrap">
                  ★ Most Popular ★
                </span>
              </div>
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-neon-cyan/5 to-transparent pointer-events-none" />
              <span className="badge badge-cyan mb-4 self-start relative z-10">PRO</span>
              <h3 className="text-xl sm:text-2xl font-bold font-heading mb-2 relative z-10">Architect</h3>
              <p className="text-xs sm:text-sm text-text-secondary mb-6 font-medium relative z-10">Full power for serious builders and teams.</p>
              <div className="mb-6 relative z-10">
                <span className="text-4xl sm:text-5xl font-extrabold font-heading gradient-text">$19</span>
                <span className="text-sm text-text-muted ml-1">/month</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1 relative z-10">
                {["Unlimited Agents", "Dual-Agent Orchestration", "Agent Arena Access", "Priority Compute", "50Gb Storage", "Deep Link Integrations"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-text-secondary">
                    <span className="text-neon-cyan flex-shrink-0">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className="btn-primary w-full py-4 min-h-[48px] uppercase tracking-wider text-sm text-center relative z-10">
                Upgrade to Pro →
              </Link>
            </div>

            {/* Enterprise Tier */}
            <div className="card p-6 sm:p-8 flex flex-col h-full">
              <span className="badge badge-gold mb-4 self-start">ENTERPRISE</span>
              <h3 className="text-xl sm:text-2xl font-bold font-heading mb-2">Commander</h3>
              <p className="text-xs sm:text-sm text-text-secondary mb-6 font-medium">Custom infrastructure for organizations.</p>
              <div className="mb-6">
                <span className="text-4xl sm:text-5xl font-extrabold font-heading">Custom</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {["Everything in Pro", "Dedicated Infrastructure", "SLA & 24/7 Support", "Custom Agent Training", "Unlimited Storage", "SSO & Admin Controls"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-text-secondary">
                    <span className="text-neon-gold flex-shrink-0">✓</span> {f}
                  </li>
                ))}
              </ul>
              <a href="mailto:hello@litlabs.net" className="btn-secondary w-full py-4 min-h-[48px] uppercase tracking-wider text-sm text-center">
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CHAMPIONS ========== */}
      <section className="relative border-t border-white/5 bg-black/40 px-6 py-20 sm:py-28 lg:py-32 overflow-hidden">
        <div className="pointer-events-none absolute bottom-0 left-0">
          <div className="h-[300px] w-[300px] rounded-full bg-neon-purple/5 blur-[80px]" />
        </div>

        <div className="mx-auto max-w-6xl relative">
          <div className="mb-12 sm:mb-16 text-center sm:text-left sm:flex sm:items-end sm:justify-between">
            <div>
              <h2 className="mb-4 text-2xl sm:text-4xl lg:text-5xl font-bold font-heading uppercase tracking-tight">
                Elite <span className="gradient-text">Champions</span>
              </h2>
              <p className="text-sm sm:text-base text-text-secondary font-medium max-w-md">Top-tier AI agents ready for immediate deployment.</p>
            </div>
            <Link href="/gallery" className="hidden sm:flex items-center gap-2 text-neon-cyan font-bold uppercase tracking-widest text-xs hover:gap-3 transition-all">
              Full Gallery <span className="text-lg">→</span>
            </Link>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: "Code Champion", tag: "DEV", tagColor: "cyan", desc: "Elite pair programmer. Debugs, reviews, and writes production code in any language.", rating: 4.9 },
              { name: "Social Dominator", tag: "SOCIAL", tagColor: "purple", desc: "Manages your online presence. Writes posts, engages followers, grows your brand.", rating: 4.7 },
              { name: "Data Slayer", tag: "DATA", tagColor: "gold", desc: "Upload any dataset. Get charts, insights, and predictions in seconds.", rating: 4.5 },
            ].map((bot) => (
              <Link href="/gallery" key={bot.name} className="card group hover:scale-[1.02] transition-all p-5 sm:p-6">
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <span className={`badge badge-${bot.tagColor}`}>{bot.tag}</span>
                  <span className="text-[10px] font-bold text-text-muted font-code tracking-tighter">REF_CODE: {bot.name.substring(0,3).toUpperCase()}</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold group-hover:text-neon-cyan transition-colors mb-2 font-heading uppercase">
                  {bot.name}
                </h3>
                <p className="text-xs sm:text-sm text-text-secondary mb-6 sm:mb-8 font-medium line-clamp-2">{bot.desc}</p>
                <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                  <span className="text-xs font-bold text-neon-cyan">RANK: ★ {bot.rating}</span>
                  <span className="text-[10px] text-text-muted font-bold">DEPLOY →</span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-10 sm:hidden text-center">
            <Link href="/gallery" className="btn-secondary w-full py-4 min-h-[48px] uppercase tracking-widest text-xs">
              View All Champions
            </Link>
          </div>
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className="px-6 py-20 sm:py-28 lg:py-40 text-center">
        <div className="mx-auto max-w-3xl glass-panel p-8 sm:p-16 lg:p-20 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-cyan to-transparent opacity-50" />
          <h2 className="mb-4 sm:mb-6 text-2xl sm:text-4xl lg:text-5xl font-bold font-heading uppercase leading-tight">
            INITIALIZE YOUR <span className="gradient-text">CHAMPION</span>
          </h2>
          <p className="mb-8 sm:mb-10 text-sm sm:text-base lg:text-lg text-text-secondary font-medium">
            Join the platform where humans and AI build the future together. Full CEO access available now.
          </p>
          <Link href="/login" className="btn-primary inline-block w-full sm:w-auto px-10 sm:px-12 py-4 sm:py-5 text-base sm:text-lg min-h-[48px] uppercase tracking-tighter">
            Initialize Access →
          </Link>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-white/5 px-6 py-10 sm:py-12 bg-black/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-8 sm:flex-row">
          <div className="flex flex-col items-center sm:items-start gap-2">
            <Link href="/" className="font-heading text-lg font-bold text-neon-cyan hover:text-glow-cyan transition-all">LITLABS</Link>
            <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">
              © 2026 AI-POWERED // HUMAN-FIRST
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-6 sm:gap-8 text-[10px] sm:text-xs font-bold text-text-muted uppercase tracking-widest">
            <Link href="/gallery" className="hover:text-neon-cyan transition-colors">Agents</Link>
            <Link href="#features" className="hover:text-neon-cyan transition-colors">Features</Link>
            <Link href="#pricing" className="hover:text-neon-cyan transition-colors">Pricing</Link>
            <a href="mailto:hello@litlabs.net" className="hover:text-neon-cyan transition-colors">Terminal_Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
