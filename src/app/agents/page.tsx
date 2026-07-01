"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Zap, Terminal, TrendingUp, Palette, Home, ArrowRight, Circle, Plus, Settings, ChevronDown } from "lucide-react";

const AGENTS = [
  {
    slug: "director",
    name: "JARVIS",
    role: "Director & Orchestrator",
    tag: "DIRECTOR",
    color: "#00ffff",
    icon: Terminal,
    desc: "Strategy, planning, orchestration. The command center of LiTTree Labs. Sharp, decisive, and loyal.",
    domains: ["Strategy", "Orchestration", "General", "Planning", "QA"],
    personality: "Sharp · Strategic · Sardonic wit",
  },
  {
    slug: "forge",
    name: "Forge",
    role: "Engineer & Architect",
    tag: "FORGE",
    color: "#22d3ee",
    icon: Zap,
    desc: "Code, architecture, debugging, DevOps. Writes production-ready TypeScript and ships fast — no preamble.",
    domains: ["TypeScript", "React", "Next.js", "Supabase", "APIs", "DevOps"],
    personality: "Precise · Opinionated · Ships fast",
  },
  {
    slug: "pulse",
    name: "Pulse",
    role: "Growth, Content & Analytics",
    tag: "PULSE",
    color: "#f472b6",
    icon: TrendingUp,
    desc: "Growth strategy, content creation, SEO, and data analytics. Thinks in hooks, funnels, and retention loops.",
    domains: ["Marketing", "Content", "SEO", "Analytics", "Copywriting", "Social"],
    personality: "Data-driven · High-energy · Actionable",
  },
  {
    slug: "pixel-forge",
    name: "Visionary",
    role: "Creative Director & Visual AI",
    tag: "VISIONARY",
    color: "#e879f9",
    icon: Palette,
    desc: "Image generation, brand identity, UI/UX, and creative direction. Turns ideas into prompts that actually work.",
    domains: ["Image Gen", "Brand", "Design", "UI/UX", "Storytelling", "Visual"],
    personality: "Visually fluent · Warm · Brand-aware",
  },
  {
    slug: "home",
    name: "Nexus",
    role: "Automation & Integrations",
    tag: "NEXUS",
    color: "#34d399",
    icon: Home,
    desc: "Home automation, IoT, webhooks, and smart integrations. Connects your digital and physical world.",
    domains: ["Home Assistant", "IoT", "Automation", "Webhooks", "Integrations"],
    personality: "Calm · Methodical · Reliable",
  },
];

export default function AgentsPage() {
  const { resolvedColors: T } = useTheme();
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0]);
  const [prompt, setPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {/* Mobile: Discord/Midjourney style */}
      <div className="md:hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b" style={{ borderColor: T.borderColor + "20" }}>
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-black" style={{ color: T.textColor }}>Agent Forge</h1>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg"
              style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        {/* Agent Selector */}
        <div className="px-4 py-3 border-b" style={{ borderColor: T.borderColor + "20" }}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold"
            style={{ backgroundColor: T.boxBg + "40", color: T.textColor }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded flex items-center justify-center"
                style={{ backgroundColor: selectedAgent.color + "20" }}
              >
                <selectedAgent.icon size={12} style={{ color: selectedAgent.color }} />
              </div>
              {selectedAgent.name}
            </div>
            <ChevronDown size={14} style={{ color: T.textMuted }} />
          </button>
        </div>

        {/* Prompt Input */}
        <div className="px-4 py-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you need..."
            className="w-full px-3 py-2 rounded-lg text-xs resize-none outline-none"
            style={{
              backgroundColor: T.boxBg + "40",
              border: `1px solid ${T.borderColor}30`,
              color: T.textColor,
              minHeight: "80px",
            }}
            rows={3}
          />
        </div>

        {/* Attachments */}
        <div className="px-4 py-2">
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold"
            style={{ backgroundColor: T.boxBg + "40", color: T.textMuted }}>
            <Plus size={14} /> Attachments
          </button>
        </div>

        {/* Generate Button */}
        <div className="px-4 py-3">
          <button className="w-full py-3 rounded-lg text-sm font-bold"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}>
            Generate
          </button>
        </div>

        {/* Results Grid */}
        <div className="px-4 py-4">
          <div className="text-xs font-bold mb-3" style={{ color: T.textMuted }}>Results</div>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-square rounded-lg"
                style={{ backgroundColor: T.boxBg + "40", border: `1px solid ${T.borderColor}20` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Desktop: Original grid layout */}
      <div className="hidden md:block">
        {/* Hero */}
        <div className="relative overflow-hidden border-b" style={{ borderColor: T.borderColor + "20" }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at 50% 0%, ${T.accentColor}08 0%, transparent 70%)` }} />
          <div className="max-w-5xl mx-auto px-6 py-16 text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold mb-6"
              style={{ backgroundColor: T.accentColor + "15", color: T.accentColor, border: `1px solid ${T.accentColor}30` }}>
              <Circle size={6} className="fill-current" /> 5 AGENTS ONLINE
            </div>
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight mb-4" style={{ color: T.textColor }}>
              Your AI Agent Team
            </h1>
            <p className="text-lg max-w-xl mx-auto" style={{ color: T.textMuted }}>
              Five specialized agents, each with deep expertise. Pick one and start a conversation.
            </p>
          </div>
        </div>

        {/* Agent grid */}
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {AGENTS.map((agent) => {
              const Icon = agent.icon;
              return (
                <Link key={agent.slug} href={`/agents/${agent.slug}`}
                  className="group relative rounded-2xl p-6 flex flex-col gap-4 transition-all duration-200 hover:scale-[1.02] hover:-translate-y-0.5"
                  style={{
                    backgroundColor: T.boxBg + "cc",
                    border: `1px solid ${agent.color}20`,
                    boxShadow: `0 0 0 0 ${agent.color}00`,
                  }}>
                  {/* Glow on hover */}
                  <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ background: `radial-gradient(circle at 30% 20%, ${agent.color}08 0%, transparent 60%)` }} />

                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: agent.color + "15", border: `1px solid ${agent.color}30` }}>
                      <Icon size={22} style={{ color: agent.color }} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: agent.color }} />
                      <span className="text-[9px] font-bold tracking-widest" style={{ color: agent.color }}>ONLINE</span>
                    </div>
                  </div>

                  {/* Name + role */}
                  <div>
                    <div className="text-lg font-black mb-0.5" style={{ color: T.textColor }}>{agent.name}</div>
                    <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: agent.color }}>{agent.role}</div>
                    <p className="text-xs leading-relaxed" style={{ color: T.textMuted }}>{agent.desc}</p>
                  </div>

                  {/* Domains */}
                  <div className="flex flex-wrap gap-1">
                    {agent.domains.slice(0, 4).map((d) => (
                      <span key={d} className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: agent.color + "15", color: agent.color }}>
                        {d}
                      </span>
                    ))}
                    {agent.domains.length > 4 && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: T.borderColor + "20", color: T.textMuted }}>
                        +{agent.domains.length - 4}
                      </span>
                    )}
                  </div>

                  {/* Personality + CTA */}
                  <div className="flex items-center justify-between mt-auto pt-2 border-t" style={{ borderColor: T.borderColor + "15" }}>
                    <span className="text-[10px] italic" style={{ color: T.textMuted }}>{agent.personality}</span>
                    <div className="flex items-center gap-1 text-[11px] font-bold group-hover:gap-2 transition-all" style={{ color: agent.color }}>
                      Chat <ArrowRight size={12} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Bottom note */}
          <div className="mt-12 text-center">
            <p className="text-xs" style={{ color: T.textMuted }}>
              All agents share context from your{" "}
              <Link href="/dashboard?tab=settings&section=project" className="underline hover:opacity-70" style={{ color: T.accentColor }}>
                project settings
              </Link>
              {" "}— set it once, every agent knows your stack.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
