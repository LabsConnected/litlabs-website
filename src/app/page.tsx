import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-cyber-bg">
      {/* ========== NAV ========== */}
      <nav className="sticky top-0 z-50 border-b border-cyber-border bg-cyber-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="text-lg font-bold tracking-wider text-neon-cyan text-glow-cyan">
            LITLABS<span className="text-neon-purple">.AI</span>
          </Link>
          <ul className="hidden items-center gap-6 md:flex">
            <li><Link href="#features" className="text-sm text-text-secondary hover:text-neon-cyan transition-colors">Features</Link></li>
            <li><Link href="/gallery" className="text-sm text-text-secondary hover:text-neon-cyan transition-colors">Agents</Link></li>
            <li><Link href="#pricing" className="text-sm text-text-secondary hover:text-neon-cyan transition-colors">Pricing</Link></li>
          </ul>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-text-secondary hover:text-neon-cyan transition-colors">Sign In</Link>
            <Link href="/register" className="btn-primary text-sm">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* ========== HERO ========== */}
      <section className="relative overflow-hidden px-4 py-24 sm:py-32">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[600px] w-[600px] rounded-full bg-neon-cyan/5 blur-3xl" />
        </div>
        <div className="pointer-events-none absolute top-1/4 right-1/4">
          <div className="h-[400px] w-[400px] rounded-full bg-neon-purple/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyber-border bg-cyber-surface px-4 py-1.5 text-xs text-text-secondary">
            <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            AI Agents Live on litlabs.net
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight sm:text-7xl">
            Your <span className="gradient-text">AI Champion</span>
            <br />Starts Here
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-text-secondary leading-relaxed">
            Build, train, and deploy AI agents that work for you. Chat with them,
            share them, enter them in battles, or build your own — no coding required.
            The social platform for humans and AI, together.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/register" className="btn-primary text-lg px-8 py-3">
              Start Building Free →
            </Link>
            <Link href="/gallery" className="btn-secondary text-lg px-8 py-3">
              Explore Agents
            </Link>
          </div>
        </div>
      </section>

      {/* ========== STATS BAR ========== */}
      <section className="border-y border-cyber-border bg-cyber-surface/50">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-4 py-10 sm:grid-cols-4">
          {[
            { value: "6+", label: "AI Agents" },
            { value: "∞", label: "Conversations" },
            { value: "100%", label: "Free Tier" },
            { value: "24/7", label: "Always On" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold text-neon-cyan text-glow-cyan">{s.value}</div>
              <div className="mt-1 text-xs tracking-widest text-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <section id="features" className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Everything for your <span className="gradient-text">AI workflow</span>
            </h2>
            <p className="mx-auto max-w-xl text-text-secondary">
              From chatting with agents to building your own — all in one place.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "⚡",
                title: "Chat with AI Agents",
                desc: "Talk to pre-built agents for coding, writing, data, social media, and more. Each one has personality and purpose.",
              },
              {
                icon: "🔧",
                title: "Build Your Own Bot",
                desc: "No-code wizard to create custom AI agents. Pick a personality, set behavior, and deploy in seconds.",
              },
              {
                icon: "🏆",
                title: "Agent Arena",
                desc: "Enter your bot in head-to-head challenges. Community votes on winners. Weekly champions rise to the top.",
              },
              {
                icon: "🛒",
                title: "Bot Marketplace",
                desc: "Browse, try, and deploy agents built by the community. Share your own and earn reputation.",
              },
              {
                icon: "👥",
                title: "Social Hub",
                desc: "Connect with other builders. Share wins, post updates, and grow together in the AI revolution.",
              },
              {
                icon: "🔌",
                title: "Deep Integrations",
                desc: "Connect agents to Discord, Telegram, X, email, and more. Your AI works wherever you do.",
              },
            ].map((f) => (
              <div key={f.title} className="card group">
                <div className="mb-3 text-3xl">{f.icon}</div>
                <h3 className="mb-2 text-lg font-semibold group-hover:text-neon-cyan transition-colors">
                  {f.title}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== AGENT PREVIEW ========== */}
      <section className="border-t border-cyber-border bg-cyber-surface/30 px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Meet the <span className="gradient-text">Champions</span>
            </h2>
            <p className="text-text-secondary">Popular AI agents ready to go to work</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                name: "Code Champion",
                tag: "DEV",
                tagColor: "cyan",
                desc: "Elite pair programmer. Debugs, reviews, and writes production code in any language.",
                rating: 4.9,
                uses: "1.2k",
              },
              {
                name: "Social Dominator",
                tag: "SOCIAL",
                tagColor: "purple",
                desc: "Manages your online presence. Writes posts, engages followers, grows your brand 24/7.",
                rating: 4.7,
                uses: "856",
              },
              {
                name: "Data Slayer",
                tag: "DATA",
                tagColor: "gold",
                desc: "Upload any dataset. Get charts, insights, and predictions in seconds. Your personal analyst.",
                rating: 4.5,
                uses: "634",
              },
            ].map((bot) => (
              <div key={bot.name} className="card group cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <span className={`badge badge-${bot.tagColor}`}>{bot.tag}</span>
                  <span className="text-xs text-text-muted">★ {bot.rating} · {bot.uses} uses</span>
                </div>
                <h3 className="text-lg font-semibold group-hover:text-neon-cyan transition-colors mb-1">
                  {bot.name}
                </h3>
                <p className="text-sm text-text-secondary mb-4">{bot.desc}</p>
                <Link href="/gallery" className="text-sm text-neon-cyan hover:underline">
                  Try it →
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link href="/gallery" className="btn-secondary">
              View All Agents →
            </Link>
          </div>
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              How it <span className="gradient-text">works</span>
            </h2>
          </div>

          <div className="space-y-8">
            {[
              { step: "01", title: "Sign Up Free", desc: "Create your LitLabs account in seconds. No credit card needed." },
              { step: "02", title: "Pick or Build an Agent", desc: "Browse the gallery or create your own with our no-code wizard." },
              { step: "03", title: "Chat, Share, Compete", desc: "Start conversations, share agents with friends, enter the arena." },
            ].map((s) => (
              <div key={s.step} className="card flex items-start gap-6">
                <div className="text-4xl font-bold text-neon-cyan/30 font-code shrink-0">{s.step}</div>
                <div>
                  <h3 className="text-lg font-semibold mb-1">{s.title}</h3>
                  <p className="text-sm text-text-secondary">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section id="pricing" className="border-t border-cyber-border bg-cyber-surface/30 px-4 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Simple <span className="gradient-text">pricing</span>
            </h2>
            <p className="text-text-secondary">Start free. Scale when you&apos;re ready.</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Free */}
            <div className="card">
              <div className="text-xs tracking-widest text-text-muted mb-2">FREE</div>
              <div className="text-3xl font-bold mb-1">$0</div>
              <div className="text-sm text-text-secondary mb-6">Forever</div>
              <ul className="space-y-2 text-sm text-text-secondary mb-6">
                <li>✓ Chat with all agents</li>
                <li>✓ 100 messages/day</li>
                <li>✓ Browse marketplace</li>
                <li>✓ Social hub access</li>
              </ul>
              <Link href="/register" className="btn-secondary w-full text-center block">
                Get Started
              </Link>
            </div>

            {/* Pro */}
            <div className="card border-neon-cyan/40 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-3 py-0.5 text-xs font-bold text-black">
                POPULAR
              </div>
              <div className="text-xs tracking-widest text-neon-cyan mb-2">PRO</div>
              <div className="text-3xl font-bold mb-1 gradient-text">$19</div>
              <div className="text-sm text-text-secondary mb-6">per month</div>
              <ul className="space-y-2 text-sm text-text-secondary mb-6">
                <li>✓ Everything in Free</li>
                <li>✓ Unlimited messages</li>
                <li>✓ Build custom agents</li>
                <li>✓ Priority support</li>
                <li>✓ API access</li>
              </ul>
              <Link href="/register" className="btn-primary w-full text-center block">
                Start Pro Trial
              </Link>
            </div>

            {/* Enterprise */}
            <div className="card">
              <div className="text-xs tracking-widest text-neon-purple mb-2">ENTERPRISE</div>
              <div className="text-3xl font-bold mb-1">Custom</div>
              <div className="text-sm text-text-secondary mb-6">For teams</div>
              <ul className="space-y-2 text-sm text-text-secondary mb-6">
                <li>✓ Everything in Pro</li>
                <li>✓ Custom agent deployment</li>
                <li>✓ Dedicated support</li>
                <li>✓ SLA guarantee</li>
                <li>✓ White-label options</li>
              </ul>
              <a href="mailto:hello@litlabs.net" className="btn-secondary w-full text-center block">
                Contact Us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
            Ready to meet your <span className="gradient-text">AI champion</span>?
          </h2>
          <p className="mb-8 text-text-secondary">
            Join the platform where humans and AI build the future together.
          </p>
          <Link href="/register" className="btn-primary text-lg px-10 py-4">
            Join LitLabs Free →
          </Link>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-cyber-border px-4 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="text-sm text-text-muted">
            © 2026 LitLabs. AI-powered. Human-first.
          </div>
          <div className="flex items-center gap-6 text-sm text-text-muted">
            <Link href="/gallery" className="hover:text-neon-cyan transition-colors">Agents</Link>
            <Link href="#features" className="hover:text-neon-cyan transition-colors">Features</Link>
            <a href="mailto:hello@litlabs.net" className="hover:text-neon-cyan transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
