"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Bot,
  BarChart3,
  ChevronRight,
  Shield,
  ArrowRight,
  Globe,
  Coins,
  Sparkles,
  Rocket,
  Workflow,
  Layers3,
  MessageSquareText,
  Users,
  LogIn,
  UserPlus,
  Zap,
  Check,
  Crown,
  Star,
  Code2,
  Music,
  Image,
  Terminal,
  Gamepad2,
  ShoppingBag,
  Brain,
  Activity,
} from "lucide-react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG = "#08080c";
const PANEL = "#101018";
const BORDER = "#22222e";
const CYAN = "#22d3ee";
const GREEN = "#a3f546";
const INDIGO = "#6366f1";
const TEXT = "#f0f0f6";
const MUTED = "#64748b";

// ─── OS modules ───────────────────────────────────────────────────────────────
const OS_MODULES = [
  { icon: MessageSquareText, label: "Chat",        sub: "Always-on AI",       color: CYAN,    href: "/studio?tool=chat" },
  { icon: Sparkles,          label: "Studio",      sub: "Create anything",    color: "#e879f9", href: "/studio" },
  { icon: Bot,               label: "Agents",      sub: "Your AI crew",       color: GREEN,   href: "/agents" },
  { icon: Gamepad2,          label: "Arcade",      sub: "25+ free games",     color: "#fb923c", href: "/games/cloud" },
  { icon: ShoppingBag,       label: "Marketplace", sub: "Buy & sell agents",  color: "#f472b6", href: "/marketplace" },
  { icon: Code2,             label: "Terminal",    sub: "Real dev terminal",  color: "#4ade80", href: "/studio?tool=chat" },
  { icon: Music,             label: "Music",       sub: "AI music studio",    color: "#a78bfa", href: "/studio" },
  { icon: Image,             label: "Gallery",     sub: "All your assets",    color: "#fbbf24", href: "/gallery" },
  { icon: Activity,          label: "Social",      sub: "Creator community",  color: "#f87171", href: "/social" },
  { icon: Brain,             label: "Memory",      sub: "LiT remembers you",  color: "#34d399", href: "/studio?tool=chat" },
  { icon: BarChart3,         label: "Analytics",   sub: "Track everything",   color: "#60a5fa", href: "/dashboard" },
  { icon: Terminal,          label: "Console",     sub: "Mission control",    color: CYAN,    href: "/studio?tool=chat" },
];

// ─── Agents ───────────────────────────────────────────────────────────────────
const AGENTS = [
  { emoji: "🤖", name: "Director",       role: "Orchestrator",  desc: "Routes tasks across your entire agent workforce.",          color: CYAN,    href: "/agents/director" },
  { emoji: "⚡", name: "Forge",          role: "Engineer",      desc: "Writes, debugs, and ships full-stack code.",                color: GREEN,   href: "/agents/code-champion" },
  { emoji: "🎨", name: "Visionary",      role: "Creative",      desc: "Generates images, UI direction, and brand visuals.",        color: "#e879f9", href: "/agents/pixel-forge" },
  { emoji: "📱", name: "SocialPilot",    role: "Growth",        desc: "Plans content and grows your audience across platforms.",   color: "#fb923c", href: "/agents/social-dominator" },
  { emoji: "📊", name: "Data Slayer",    role: "Analytics",     desc: "Turns raw numbers into actionable insights.",               color: "#fbbf24", href: "/agents/data-slayer" },
  { emoji: "🎵", name: "Music Producer", role: "Audio",         desc: "Composition, mixing, and sound design on demand.",         color: "#a78bfa", href: "/agents/music-producer" },
];

// ─── Pricing tiers ────────────────────────────────────────────────────────────
const TIERS = [
  {
    name: "Starter",
    price: "Free",
    period: "forever",
    badge: null,
    color: MUTED,
    desc: "Everything you need to get started with AI creation.",
    features: [
      "500 starter credits",
      "LiT Chat (unlimited)",
      "3 active agents",
      "Studio access (basic)",
      "Game Arcade (all games)",
      "Community feed",
      "500MB gallery storage",
    ],
    cta: "Start Free",
    href: "/sign-up",
    highlight: false,
  },
  {
    name: "Creator",
    price: "$12",
    period: "per month",
    badge: "Most Popular",
    color: CYAN,
    desc: "For builders shipping real work with AI every day.",
    features: [
      "5,000 credits / month",
      "All 5 core agents",
      "Workflow Studio (Flow)",
      "Terminal access",
      "Marketplace buying",
      "5GB gallery storage",
      "Priority AI responses",
      "Social & community tools",
    ],
    cta: "Start Creator",
    href: "/sign-up?plan=creator",
    highlight: true,
  },
  {
    name: "Elite",
    price: "$39",
    period: "per month",
    badge: "Owner Tier",
    color: GREEN,
    desc: "Full LiT OS power. Sell agents, run workflows, unlimited everything.",
    features: [
      "Unlimited credits",
      "All agents + custom agents",
      "Marketplace selling",
      "Agent Builder Studio",
      "SSH Terminal",
      "Unlimited gallery storage",
      "API access",
      "White-label workspace",
      "Early feature access",
      "Direct support",
    ],
    cta: "Go Elite",
    href: "/sign-up?plan=elite",
    highlight: false,
  },
];

function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: BG, color: TEXT }}>

      {/* ── HEADER ── */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-4 sm:px-8 h-14 border-b"
        style={{ backgroundColor: `${BG}ee`, backdropFilter: "blur(16px)", borderColor: `${BORDER}60` }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs"
            style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff" }}>L</div>
          <span className="font-black text-sm tracking-wide" style={{ color: TEXT }}>LiTTree OS</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-xs font-bold" style={{ color: MUTED }}>
          {[["Features","#features"],["Agents","#agents"],["Pricing","#pricing"],["Studio","/studio"],["Games","/games/cloud"]].map(([l,h]) => (
            <Link key={l} href={h} className="hover:text-white transition-colors">{l}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all hover:opacity-80" style={{ color: "#a5b4fc" }}>
            <LogIn size={13} /> Sign In
          </Link>
          <Link href="/sign-up" className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-black transition-all hover:scale-105"
            style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff", boxShadow: `0 0 20px ${INDIGO}40` }}>
            <UserPlus size={13} /> Get Started
          </Link>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative px-4 pt-20 pb-16 md:pt-32 md:pb-28 text-center overflow-hidden">
        {/* Background glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full opacity-15"
            style={{ background: `radial-gradient(ellipse, ${INDIGO}60 0%, transparent 70%)`, filter: "blur(60px)" }} />
          <div className="absolute top-20 left-1/4 w-64 h-64 rounded-full opacity-10"
            style={{ background: `radial-gradient(circle, ${CYAN}50 0%, transparent 70%)`, filter: "blur(50px)" }} />
          <div className="absolute top-10 right-1/4 w-64 h-64 rounded-full opacity-10"
            style={{ background: `radial-gradient(circle, ${GREEN}50 0%, transparent 70%)`, filter: "blur(50px)" }} />
          {/* Top border glow line */}
          <div className="absolute inset-x-0 top-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${INDIGO}80, ${CYAN}60, transparent)` }} />
        </div>

        <div className="relative max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-8 border"
            style={{ borderColor: `${CYAN}40`, backgroundColor: `${CYAN}08`, color: CYAN }}>
            <Sparkles size={11} /> The AI Operating System for Creators
          </div>

          <h1 className="text-5xl md:text-8xl font-black tracking-tight mb-6 leading-[0.95]" style={{ color: TEXT }}>
            Build with AI.<br />
            <span className="bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(135deg, ${CYAN}, ${INDIGO}, ${GREEN})` }}>
              Ship everything.
            </span>
          </h1>

          <p className="text-lg md:text-xl mb-10 max-w-2xl mx-auto leading-relaxed" style={{ color: MUTED }}>
            LiT OS is the one workspace where you chat, code, create, deploy agents,
            play, sell, and collaborate — all without leaving.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Link href="/sign-up"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-black transition-all hover:scale-105 hover:brightness-110"
              style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff", boxShadow: `0 0 40px ${INDIGO}40` }}>
              Start Free — 500 Credits <ArrowRight size={16} />
            </Link>
            <Link href="/sign-in"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-bold border transition-all hover:bg-white/5"
              style={{ borderColor: BORDER, color: MUTED }}>
              <LogIn size={15} /> Sign In
            </Link>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10 text-center">
            {[["5","Core AI Agents"],["25+","Free Games"],["∞","AI Conversations"],["500","Starter Credits"]].map(([v,l]) => (
              <div key={l}>
                <div className="text-2xl font-black" style={{ color: TEXT }}>{v}</div>
                <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: MUTED }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OS MODULES GRID ── */}
      <section className="px-4 py-16 border-t" style={{ borderColor: `${BORDER}50` }} id="features">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-5xl font-black mb-3" style={{ color: TEXT }}>One OS. Every Tool.</h2>
            <p className="text-sm" style={{ color: MUTED }}>Everything opens from LiT — nothing lives on a separate site.</p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {OS_MODULES.map((m) => {
              const Icon = m.icon;
              return (
                <Link key={m.label} href={m.href}
                  className="group flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all hover:scale-[1.03] hover:border-opacity-60 text-center"
                  style={{ backgroundColor: PANEL, borderColor: BORDER }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110"
                    style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                    <Icon size={18} />
                  </div>
                  <div className="text-xs font-black" style={{ color: TEXT }}>{m.label}</div>
                  <div className="text-[9px] leading-tight" style={{ color: MUTED }}>{m.sub}</div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── AGENTS ── */}
      <section className="px-4 py-20 border-t" style={{ borderColor: `${BORDER}50` }} id="agents">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl font-black mb-3" style={{ color: TEXT }}>Your AI Workforce</h2>
            <p className="text-sm" style={{ color: MUTED }}>5 core agents — each with a real job and a distinct personality.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AGENTS.map((a) => (
              <Link key={a.name} href={a.href}
                className="group flex items-start gap-4 p-5 rounded-2xl border transition-all hover:scale-[1.02] hover:border-opacity-50"
                style={{ backgroundColor: PANEL, borderColor: BORDER }}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 transition-all group-hover:scale-110"
                  style={{ backgroundColor: `${a.color}15`, border: `1px solid ${a.color}30` }}>
                  {a.emoji}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-black text-sm" style={{ color: TEXT }}>{a.name}</span>
                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: `${a.color}18`, color: a.color }}>{a.role}</span>
                    <span className="ml-auto w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: a.color, boxShadow: `0 0 6px ${a.color}` }} />
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: MUTED }}>{a.desc}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link href="/agents" className="inline-flex items-center gap-2 text-xs font-bold transition-all hover:opacity-100 opacity-60" style={{ color: CYAN }}>
              Meet the Agent Team <ChevronRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="px-4 py-20 border-t" style={{ borderColor: `${BORDER}50` }} id="pricing">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-5xl font-black mb-3" style={{ color: TEXT }}>
              Plans for Every Creator
            </h2>
            <p className="text-sm" style={{ color: MUTED }}>
              Start free. Scale when you&apos;re ready. Owner gets everything.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 items-start">
            {TIERS.map((tier) => (
              <div key={tier.name}
                className="relative rounded-2xl border p-6 flex flex-col"
                style={{
                  backgroundColor: tier.highlight ? `${CYAN}06` : PANEL,
                  borderColor: tier.highlight ? `${CYAN}50` : BORDER,
                  boxShadow: tier.highlight ? `0 0 40px ${CYAN}18` : "none",
                }}>
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
                    style={{ backgroundColor: tier.highlight ? CYAN : GREEN, color: "#000" }}>
                    {tier.badge}
                  </div>
                )}

                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-2">
                    {tier.name === "Starter" && <Zap size={16} style={{ color: MUTED }} />}
                    {tier.name === "Creator" && <Star size={16} style={{ color: CYAN }} />}
                    {tier.name === "Elite" && <Crown size={16} style={{ color: GREEN }} />}
                    <span className="font-black text-lg" style={{ color: TEXT }}>{tier.name}</span>
                  </div>
                  <div className="flex items-end gap-1.5 mb-2">
                    <span className="text-4xl font-black" style={{ color: tier.highlight ? CYAN : TEXT }}>{tier.price}</span>
                    {tier.price !== "Free" && <span className="text-xs mb-1.5" style={{ color: MUTED }}>/{tier.period}</span>}
                    {tier.price === "Free" && <span className="text-xs mb-1.5" style={{ color: MUTED }}>{tier.period}</span>}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: MUTED }}>{tier.desc}</p>
                </div>

                <Link href={tier.href}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm mb-5 transition-all hover:scale-[1.02]"
                  style={{
                    background: tier.highlight
                      ? `linear-gradient(135deg, ${INDIGO}, ${CYAN})`
                      : tier.name === "Elite"
                      ? `linear-gradient(135deg, ${GREEN}80, ${GREEN})`
                      : `${BORDER}`,
                    color: tier.name === "Starter" ? MUTED : "#000",
                    boxShadow: tier.highlight ? `0 0 24px ${CYAN}30` : "none",
                  }}>
                  {tier.cta} <ArrowRight size={14} />
                </Link>

                <div className="space-y-2.5">
                  {tier.features.map((f) => (
                    <div key={f} className="flex items-start gap-2.5">
                      <Check size={13} className="shrink-0 mt-0.5" style={{ color: tier.color === MUTED ? "#4ade80" : tier.color }} />
                      <span className="text-xs leading-relaxed" style={{ color: TEXT }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs mt-6" style={{ color: MUTED }}>
            All plans include the Arcade, community feed, and LiT Chat. No surprise charges.
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-4 py-20 border-t" style={{ borderColor: `${BORDER}50` }}>
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-black mb-3" style={{ color: TEXT }}>Up in Minutes</h2>
          <p className="text-sm mb-12" style={{ color: MUTED }}>Three steps from zero to shipping.</p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { n: "01", t: "Boot Into LiT OS", d: "Sign up free, meet LiTT your AI assistant, and boot into your personal operating system.", icon: Rocket },
              { n: "02", t: "Pick Your Agents", d: "Choose from 10 specialists or let Director route your work automatically across the crew.", icon: Bot },
              { n: "03", t: "Ship the Result", d: "Post it, sell it in the Marketplace, deploy it, or wire it into an automated workflow.", icon: Globe },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="flex flex-col items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${INDIGO}30, ${CYAN}20)`, border: `1px solid ${INDIGO}40` }}>
                    <Icon size={22} style={{ color: CYAN }} />
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: INDIGO }}>{s.n}</div>
                  <h3 className="font-black" style={{ color: TEXT }}>{s.t}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{s.d}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="px-4 py-24 border-t" style={{ borderColor: `${BORDER}50` }}>
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at center, ${INDIGO}18 0%, transparent 70%)` }} />
          <div className="relative">
            <div className="text-5xl mb-6">🤖</div>
            <h2 className="text-4xl md:text-6xl font-black mb-4 leading-tight" style={{ color: TEXT }}>
              LiTT is waiting.<br />
              <span className="bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(135deg, ${CYAN}, ${GREEN})` }}>
                What are we building?
              </span>
            </h2>
            <p className="mb-10 leading-relaxed" style={{ color: MUTED }}>
              The AI OS where creators build, ship, and live. Start free — no credit card.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up"
                className="inline-flex items-center gap-2 px-10 py-4 rounded-2xl font-black text-sm transition-all hover:scale-105"
                style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff", boxShadow: `0 0 50px ${INDIGO}40` }}>
                <UserPlus size={16} /> Create Free Account
              </Link>
              <Link href="/sign-in"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-sm border transition-all hover:bg-white/5"
                style={{ borderColor: BORDER, color: MUTED }}>
                <LogIn size={15} /> Already have an account
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t px-4 py-10" style={{ borderColor: `${BORDER}50` }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start gap-8 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center font-black text-[10px]"
                style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff" }}>L</div>
              <span className="font-black text-sm" style={{ color: TEXT }}>LiTTree OS</span>
            </div>
            <p className="text-xs" style={{ color: MUTED }}>The AI Operating System for Creators.</p>
            <div className="flex items-center gap-1.5 mt-3">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px]" style={{ color: MUTED }}>All Systems Operational</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-xs" style={{ color: MUTED }}>
            <div className="space-y-2">
              <div className="font-black text-[10px] uppercase tracking-widest mb-3" style={{ color: TEXT }}>Product</div>
              {[["Agents","/agents"],["Studio","/studio"],["Gallery","/gallery"],["Marketplace","/marketplace"],["Games","/games/cloud"]].map(([l,h]) => (
                <Link key={l} href={h} className="block hover:text-white transition-colors">{l}</Link>
              ))}
            </div>
            <div className="space-y-2">
              <div className="font-black text-[10px] uppercase tracking-widest mb-3" style={{ color: TEXT }}>Resources</div>
              {[["Docs","/docs"],["Flow","/flow"],["Social","/social"],["Console","/studio?tool=chat"]].map(([l,h]) => (
                <Link key={l} href={h} className="block hover:text-white transition-colors">{l}</Link>
              ))}
            </div>
            <div className="space-y-2">
              <div className="font-black text-[10px] uppercase tracking-widest mb-3" style={{ color: TEXT }}>Company</div>
              {[["Privacy","/privacy"],["Terms","/terms"],["Cookies","/cookies"]].map(([l,h]) => (
                <Link key={l} href={h} className="block hover:text-white transition-colors">{l}</Link>
              ))}
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-8 pt-6 border-t flex items-center justify-between text-[10px]"
          style={{ borderColor: `${BORDER}40`, color: MUTED }}>
          <span>LiTTree Labs © 2026</span>
          <span>Built with LiT OS</span>
        </div>
      </footer>
    </div>
  );
}

export default function HomePage() {
  const { isSignedIn: supabaseSignedIn } = useSupabaseAuthHook();
  const { isSignedIn: clerkSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (supabaseSignedIn || clerkSignedIn) {
      router.replace("/studio?tool=chat");
    }
  }, [supabaseSignedIn, clerkSignedIn, router]);

  return <LandingPage />;
}
