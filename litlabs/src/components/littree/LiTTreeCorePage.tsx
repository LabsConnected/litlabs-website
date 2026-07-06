"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Terminal,
  Bot,
  ArrowRight,
  Sparkles,
  Send,
  Loader2,
  Brain,
  Code2,
  BarChart3,
  Palette,
  Music,
  Shield,
  Megaphone,
  PenLine,
  Home,
  Zap,
} from "lucide-react";
import { LiTTFace } from "@/components/litt/LiTTFace";
import type { LiTTMood } from "@/lib/ai/litt-router";

const AGENTS = [
  {
    id: "director",
    name: "LiTTree",
    tag: "CORE",
    role: "Core AI Copilot & Navigator",
    desc: "Your main AI brain — plans, routes tasks, navigates the platform, and grows your ideas.",
    color: "#22d3ee",
    icon: Brain,
    status: "online",
    href: "/lit-console",
  },
  {
    id: "forge",
    name: "Forge",
    tag: "FORGE",
    role: "Engineer & Architect",
    desc: "Writes, reviews, debugs, and ships production-ready TypeScript, React, and Next.js code.",
    color: "#22d3ee",
    icon: Code2,
    status: "online",
    href: "/lit-console",
  },
  {
    id: "pulse",
    name: "Pulse",
    tag: "PULSE",
    role: "Growth, Content & Analytics",
    desc: "Growth loops, viral mechanics, content calendars, SEO, and data-driven decisions.",
    color: "#f472b6",
    icon: BarChart3,
    status: "online",
    href: "/lit-console",
  },
  {
    id: "pixel-forge",
    name: "Visionary",
    tag: "VISIONARY",
    role: "Creative Director & Visual AI",
    desc: "Crafts enhanced image prompts, brand identities, UI direction, and creative campaigns.",
    color: "#e879f9",
    icon: Palette,
    status: "online",
    href: "/studio",
  },
  {
    id: "social-pilot",
    name: "SocialPilot",
    tag: "SOCIAL",
    role: "Social Media Growth Agent",
    desc: "Platform-native content for Instagram, X, TikTok, LinkedIn, Reddit, and Bluesky.",
    color: "#a855f7",
    icon: Megaphone,
    status: "online",
    href: "/social",
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    tag: "ANALYTICS",
    role: "Analytics & Insights",
    desc: "Interprets metrics, identifies patterns, and translates numbers into actionable moves.",
    color: "#fbbf24",
    icon: BarChart3,
    status: "online",
    href: "/lit-console",
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    tag: "EDITOR",
    role: "Content & Copy Specialist",
    desc: "Edits for clarity, rewrites headlines, sharpens brand voice, and improves conversion copy.",
    color: "#a78bfa",
    icon: PenLine,
    status: "idle",
    href: "/lit-console",
  },
  {
    id: "music-producer",
    name: "Music Producer",
    tag: "AUDIO",
    role: "Audio & Sound Specialist",
    desc: "Composition, arrangement, mixing guidance, and sound design for creators.",
    color: "#fb7185",
    icon: Music,
    status: "idle",
    href: "/music",
  },
  {
    id: "nexus",
    name: "Nexus",
    tag: "NEXUS",
    role: "Automation & Integrations",
    desc: "Connects devices, APIs, webhooks, and smart home systems. Makes everything talk.",
    color: "#34d399",
    icon: Home,
    status: "idle",
    href: "/flow",
  },
  {
    id: "security-chief",
    name: "Security Chief",
    tag: "SECURITY",
    role: "Security & Privacy Specialist",
    desc: "Audits vulnerabilities, reviews auth flows, and locks down your systems.",
    color: "#ef4444",
    icon: Shield,
    status: "online",
    href: "/lit-console",
  },
];

const SUGGESTIONS = [
  "Build me a landing page",
  "Create a music promo post",
  "Write copy for my offer",
  "Make an AI agent for selling beats",
];

export function LiTTreeCorePage() {
  const { resolvedColors: T } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [mood, setMood] = useState<LiTTMood>("happy");
  const [activeAgent, setActiveAgent] = useState("director");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=/littree`);
      return;
    }
    setLoading(true);
    setMood("thinking");
    try {
      const res = await fetch("/api/litt/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const data = await res.json();
      setReply(data.reply || "");
      if (data.mood) setMood(data.mood as LiTTMood);
    } catch {
      setReply("LiTTree is thinking... try again in a moment.");
      setMood("sleepy");
    } finally {
      setLoading(false);
      setPrompt("");
    }
  };

  const featuredAgent = AGENTS.find((a) => a.id === "director")!;

  return (
    <main className="min-h-screen pb-20" style={{ backgroundColor: T.bgColor, color: T.textColor }}>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: T.borderColor + "20" }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse at 20% 0%, rgba(34,211,238,0.10) 0%, transparent 50%), radial-gradient(ellipse at 80% 0%, rgba(163,245,70,0.08) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-7xl mx-auto px-4 py-10 md:py-16">
          <div className="flex flex-col md:flex-row items-center gap-10">

            {/* Avatar + status */}
            <div className="flex flex-col items-center gap-3 shrink-0">
              <LiTTFace mood={mood} size={180} showBadge />
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-400" style={{ boxShadow: "0 0 6px #22c55e" }} />
                <span className="text-xs font-bold" style={{ color: "#22c55e" }}>ONLINE</span>
                <span className="text-xs opacity-40" style={{ color: T.textMuted }}>• 10 agents active</span>
              </div>
            </div>

            {/* Text + chat input */}
            <div className="flex-1 flex flex-col gap-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 text-[11px] font-black uppercase tracking-[0.2em]"
                  style={{ backgroundColor: T.accentColor + "15", border: `1px solid ${T.accentColor}30`, color: T.accentColor }}>
                  <Zap size={10} className="fill-current" /> LiTTree Agent OS
                </div>
                <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-none" style={{ color: T.headerColor }}>
                  LiTTree
                </h1>
                <p className="text-base md:text-lg mt-2 opacity-70 max-w-xl leading-relaxed">
                  Your AI agent team. 10 specialists — code, growth, creative, social, music, security, data, and more. Tell LiTTree what you need.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="w-full max-w-2xl">
                <div className="flex items-center gap-3 rounded-2xl border px-4 py-3.5"
                  style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "35" }}>
                  <Sparkles size={18} style={{ color: T.accentColor }} />
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="LiTTree, what should we build today?"
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: T.textColor }}
                  />
                  <button type="submit" disabled={loading || !prompt.trim()}
                    className="rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50"
                    style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                    {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  </button>
                </div>
                {reply && (
                  <div className="mt-3 rounded-xl border px-4 py-3 text-sm leading-relaxed"
                    style={{ borderColor: T.borderColor + "30", backgroundColor: T.boxBg, color: T.textColor }}>
                    <span className="font-bold mr-2" style={{ color: T.accentColor }}>LiTTree:</span>
                    {reply}
                  </div>
                )}
              </form>

              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => setPrompt(s)}
                    className="rounded-full px-3 py-1.5 text-[11px] font-bold transition hover:opacity-80"
                    style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}25`, color: T.textMuted }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── QUICK ACTIONS ── */}
      <section className="max-w-7xl mx-auto px-4 mt-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: "/studio", label: "Open Studio", color: "#f472b6", icon: Palette },
            { href: "/lit-console", label: "Console", color: "#22d3ee", icon: Terminal },
            { href: "/social", label: "Social", color: "#a855f7", icon: Megaphone },
            { href: "/flow", label: "Automate", color: "#34d399", icon: Bot },
          ].map(({ href, label, color, icon: Icon }) => (
            <Link key={href} href={href}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 transition hover:-translate-y-0.5"
              style={{ borderColor: color + "35" }}>
              <Icon size={16} style={{ color }} />
              <span className="text-sm font-bold" style={{ color }}>{label}</span>
              <ArrowRight size={12} className="ml-auto opacity-50" style={{ color }} />
            </Link>
          ))}
        </div>
      </section>

      {/* ── AGENT ROSTER ── */}
      <section className="max-w-7xl mx-auto px-4 mt-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-black" style={{ color: T.headerColor }}>Agent Roster</h2>
            <p className="text-sm mt-0.5 opacity-60" style={{ color: T.textMuted }}>10 specialist agents — each wired to a specific domain</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400" style={{ boxShadow: "0 0 6px #22c55e" }} />
            <span className="text-xs font-bold" style={{ color: "#22c55e" }}>7 online</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {AGENTS.map((agent) => {
            const Icon = agent.icon;
            const isActive = activeAgent === agent.id;
            return (
              <div
                key={agent.id}
                onClick={() => setActiveAgent(agent.id)}
                className="group rounded-2xl border p-5 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg"
                style={{
                  backgroundColor: isActive ? agent.color + "10" : T.boxBg,
                  borderColor: isActive ? agent.color + "50" : T.borderColor + "25",
                  boxShadow: isActive ? `0 0 20px ${agent.color}15` : "none",
                }}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ backgroundColor: agent.color + "18" }}>
                      <Icon size={20} style={{ color: agent.color }} />
                    </div>
                    <div>
                      <div className="font-black text-sm leading-tight" style={{ color: T.headerColor }}>
                        {agent.name}
                      </div>
                      <div className="text-[9px] font-black uppercase tracking-widest mt-0.5"
                        style={{ color: agent.color }}>
                        {agent.tag}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: agent.status === "online" ? "#22c55e" : "#6b7280",
                        boxShadow: agent.status === "online" ? "0 0 5px #22c55e" : "none" }} />
                    <span className="text-[9px] uppercase tracking-wider"
                      style={{ color: agent.status === "online" ? "#22c55e" : T.textMuted }}>
                      {agent.status}
                    </span>
                  </div>
                </div>

                {/* Role */}
                <p className="text-[11px] font-bold mb-1.5 opacity-70" style={{ color: T.textMuted }}>
                  {agent.role}
                </p>

                {/* Desc */}
                <p className="text-xs leading-relaxed opacity-60 mb-4" style={{ color: T.textColor }}>
                  {agent.desc}
                </p>

                {/* Actions */}
                <div className="flex gap-2">
                  <Link href={agent.href}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-center rounded-lg py-1.5 text-[11px] font-bold transition"
                    style={{ backgroundColor: agent.color, color: "#000" }}>
                    Use
                  </Link>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPrompt(`Ask ${agent.name}: `); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className="flex-1 rounded-lg py-1.5 text-[11px] border font-bold transition hover:opacity-80"
                    style={{ borderColor: agent.color + "40", color: agent.color }}>
                    Chat
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── WHAT LITTREE CAN DO ── */}
      <section className="max-w-7xl mx-auto px-4 mt-12">
        <div className="rounded-2xl border p-6 md:p-8"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }}>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: "#22d3ee18" }}>
              <Brain size={24} style={{ color: "#22d3ee" }} />
            </div>
            <div>
              <h3 className="text-lg font-black mb-2" style={{ color: T.headerColor }}>What this team can do</h3>
              <p className="text-sm opacity-75 leading-relaxed max-w-3xl" style={{ color: T.textColor }}>
                LiTTree routes your idea to the right specialist. Ask LiTTree to build a page → Forge ships it. Need a social campaign → SocialPilot writes it. Want image prompts → Visionary crafts them. Growing a brand → Pulse maps the funnel. The whole team works together from one command.
              </p>
              <Link href="/lit-console"
                className="inline-flex items-center gap-2 mt-4 rounded-xl px-5 py-2.5 text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
                <Terminal size={14} /> Open Console
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
