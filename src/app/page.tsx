"use client";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* ========== NAV BAR ========== */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0f]/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-extrabold tracking-tight text-white">
            lit<span className="text-blue-500">labs</span>
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">Pricing</a>
            <Link href="/gallery" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">Explore</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors">Log in</Link>
            <Link href="/login" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* ========== HERO ========== */}
      <section className="relative overflow-hidden px-4 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[150px]" />
        </div>
        <div className="relative mx-auto max-w-3xl text-center">
          <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
            Build the Future
            <br />
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">with AI Agents</span>
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-lg text-zinc-400 leading-relaxed">
            Your all-in-one platform to create, deploy, and manage custom AI agents. Build automations, connect tools, and scale your workflow — all from one clean interface.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="w-full sm:w-auto rounded-lg bg-blue-600 px-8 py-3.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors text-center">
              Start Building — Free
            </Link>
            <Link href="/gallery" className="w-full sm:w-auto rounded-lg border border-white/10 px-8 py-3.5 text-sm font-semibold text-zinc-300 hover:bg-white/5 hover:text-white transition-colors text-center">
              Explore Agents
            </Link>
          </div>
        </div>
      </section>

      {/* ========== SOCIAL PROOF ========== */}
      <section className="border-y border-white/5 bg-white/[0.02]">
        <div className="mx-auto grid max-w-5xl grid-cols-2 sm:grid-cols-4 divide-x divide-white/5">
          {[
            { value: "10K+", label: "Active Users" },
            { value: "50K+", label: "Agents Built" },
            { value: "99.9%", label: "Uptime" },
            { value: "4.9★", label: "Rating" },
          ].map((s, i) => (
            <div key={s.label} className={`py-8 px-4 text-center ${i > 0 ? "hidden sm:block" : ""} ${i < 2 ? "block" : ""}`}>
              <div className="text-2xl font-extrabold text-white sm:text-3xl">{s.value}</div>
              <div className="mt-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section id="features" className="px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <h2 className="mb-4 text-3xl font-extrabold sm:text-4xl">
              Everything You Need
            </h2>
            <p className="mx-auto max-w-lg text-zinc-400">
              Powerful tools to build, deploy, and manage your AI workforce — all in one place.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "🤖", title: "AI Agent Builder", desc: "Create custom AI agents with a simple no-code interface. Define behavior, set skills, and deploy in minutes." },
              { icon: "⚡", title: "Neural Chat", desc: "Chat with purpose-built agents for coding, writing, research, and analysis — each with a unique personality." },
              { icon: "🔗", title: "Integrations", desc: "Connect your agents to Discord, Telegram, Slack, and more. Your workforce works everywhere." },
              { icon: "🛠", title: "Workflow Builder", desc: "Chain agents together into powerful automations. Director & Executor modes for complex task orchestration." },
              { icon: "🏆", title: "Agent Arena", desc: "Enter your agents in head-to-head challenges. Climb the leaderboard and earn reputation." },
              { icon: "👥", title: "Community", desc: "Connect with other builders. Share wins, swap strategies, and discover new agent blueprints." },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-white/5 bg-white/[0.02] p-6 hover:border-white/15 hover:bg-white/[0.04] transition-all">
                <div className="mb-3 text-3xl">{f.icon}</div>
                <h3 className="mb-2 text-lg font-bold">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className="border-t border-white/5 px-4 py-20 sm:py-28 bg-white/[0.01]">
        <div className="mx-auto max-w-4xl">
          <div className="mb-14 text-center">
            <h2 className="mb-4 text-3xl font-extrabold sm:text-4xl">How It Works</h2>
            <p className="text-zinc-400">Three steps to your first AI agent</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              { step: "1", title: "Define", desc: "Name your agent, choose a personality, and set its core skills and knowledge base." },
              { step: "2", title: "Build", desc: "Configure tools, connect integrations, and define workflows using our visual builder." },
              { step: "3", title: "Deploy", desc: "Go live instantly. Your agent works 24/7 — in chat, on Discord, or anywhere else." },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600/20 text-blue-400 text-lg font-bold">{item.step}</div>
                <h3 className="mb-2 text-lg font-bold">{item.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section id="pricing" className="px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <h2 className="mb-4 text-3xl font-extrabold sm:text-4xl">Simple Pricing</h2>
            <p className="text-zinc-400">Free to start. Scale when you're ready.</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-3 items-start">
            {/* Free */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8">
              <h3 className="text-lg font-bold mb-1">Explorer</h3>
              <p className="text-sm text-zinc-400 mb-6">Perfect for trying things out.</p>
              <div className="mb-6">
                <span className="text-4xl font-extrabold">$0</span>
                <span className="text-sm text-zinc-500">/forever</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["3 Active Agents", "Basic Chat", "Community Access", "1GB Storage"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-zinc-300">
                    <span className="text-green-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className="block w-full rounded-lg border border-white/10 py-3 text-center text-sm font-semibold text-zinc-300 hover:bg-white/5 transition-colors">
                Get Started Free
              </Link>
            </div>

            {/* Pro */}
            <div className="rounded-xl border border-blue-500/50 bg-blue-500/5 p-8 relative order-first lg:order-none">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-bold text-white">
                Most Popular
              </div>
              <h3 className="text-lg font-bold mb-1 mt-1">Architect</h3>
              <p className="text-sm text-zinc-400 mb-6">Full power for serious builders.</p>
              <div className="mb-6">
                <span className="text-4xl font-extrabold">$19</span>
                <span className="text-sm text-zinc-500">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["Unlimited Agents", "Dual-Agent Orchestration", "Arena Access", "Priority Compute", "50GB Storage", "All Integrations"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-zinc-300">
                    <span className="text-blue-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className="block w-full rounded-lg bg-blue-600 py-3 text-center text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
                Start Pro Trial
              </Link>
            </div>

            {/* Enterprise */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8">
              <h3 className="text-lg font-bold mb-1">Commander</h3>
              <p className="text-sm text-zinc-400 mb-6">For teams and organizations.</p>
              <div className="mb-6">
                <span className="text-4xl font-extrabold">Custom</span>
              </div>
              <ul className="space-y-3 mb-8">
                {["Everything in Pro", "Dedicated Infrastructure", "SLA & Support", "Custom Training", "Unlimited Storage", "SSO & Admin"].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-zinc-300">
                    <span className="text-amber-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              <a href="mailto:hello@litlabs.net" className="block w-full rounded-lg border border-white/10 py-3 text-center text-sm font-semibold text-zinc-300 hover:bg-white/5 transition-colors">
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className="border-t border-white/5 px-4 py-20 sm:py-28 bg-white/[0.02]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-3xl font-extrabold sm:text-4xl">Ready to Build?</h2>
          <p className="mb-8 text-zinc-400">
            Join thousands of builders creating the future of AI automation.
          </p>
          <Link href="/login" className="inline-block rounded-lg bg-blue-600 px-10 py-4 text-base font-semibold text-white hover:bg-blue-500 transition-colors">
            Get Started Free →
          </Link>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-white/5 px-4 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div>
            <div className="text-lg font-extrabold tracking-tight">lit<span className="text-blue-500">labs</span></div>
            <div className="mt-1 text-xs text-zinc-500">© 2026 LitLabs. All rights reserved.</div>
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-zinc-500">
            <Link href="/gallery" className="hover:text-white transition-colors">Explore</Link>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="mailto:hello@litlabs.net" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
