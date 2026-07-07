"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Zap } from "lucide-react";
import { AGENT_AVATAR_META } from "@/lib/avatars";

const AGENTS = [
  { id: "director", name: "LiTTree", tag: "CORE", role: "Core AI Copilot & Navigator", desc: "Plans, routes tasks, navigates the platform, and grows your ideas.", color: "#22d3ee", status: "online", href: "/studio?tool=chat" },
  { id: "forge", name: "Forge", tag: "FORGE", role: "Engineer & Architect", desc: "Writes, reviews, debugs, and ships production-ready code.", color: "#22d3ee", status: "online", href: "/studio?tool=chat" },
  { id: "pulse", name: "Pulse", tag: "PULSE", role: "Growth, Content & Analytics", desc: "Growth loops, viral mechanics, content calendars, and SEO.", color: "#f472b6", status: "online", href: "/studio?tool=chat" },
  { id: "pixel-forge", name: "Visionary", tag: "VISIONARY", role: "Creative Director & Visual AI", desc: "Image prompts, brand identities, UI direction, and campaigns.", color: "#e879f9", status: "online", href: "/studio" },
  { id: "home", name: "Nexus", tag: "NEXUS", role: "Automation & Integrations", desc: "Connects devices, APIs, webhooks, and smart home systems.", color: "#34d399", status: "online", href: "/studio?tool=chat" },
  { id: "data-slayer", name: "Data Slayer", tag: "ANALYTICS", role: "Analytics & Insights", desc: "Metrics, reporting, forecasting, and data-driven decisions.", color: "#fbbf24", status: "online", href: "/studio?tool=chat" },
  { id: "writing-coach", name: "Writing Coach", tag: "EDITOR", role: "Content & Copy Specialist", desc: "Copywriting, editing, tone, headlines, and narrative craft.", color: "#a78bfa", status: "online", href: "/studio?tool=chat" },
  { id: "music-producer", name: "Music Producer", tag: "AUDIO", role: "Audio & Sound Specialist", desc: "Music production, mixing, composition, and sound design.", color: "#fb7185", status: "online", href: "/studio?tool=audio" },
  { id: "security-chief", name: "Security Chief", tag: "SECURITY", role: "Security & Privacy Specialist", desc: "Security audits, vulnerability scans, compliance, and encryption.", color: "#ef4444", status: "online", href: "/studio?tool=chat" },
  { id: "social-pilot", name: "SocialPilot", tag: "SOCIAL", role: "Social Media Growth Agent", desc: "Platform-native content for Instagram, X, TikTok, LinkedIn.", color: "#a855f7", status: "online", href: "/social" },
];

function AgentAvatar({ id, size = 56 }: { id: string; size?: number }) {
  const meta = AGENT_AVATAR_META[id];
  if (!meta) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #333, #555)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.45,
          border: "2px solid #555",
        }}
      >
        🤖
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 30% 30%, ${meta.color}40, ${meta.bg})`,
        border: `2px solid ${meta.color}50`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.5,
        lineHeight: 1,
        boxShadow: `0 0 20px ${meta.color}20`,
      }}
    >
      {meta.emoji}
    </div>
  );
}

export function LiTTreeCorePage() {
  const { resolvedColors: T } = useTheme();
  const [activeAgent, setActiveAgent] = useState("director");

  return (
    <main className="min-h-screen pb-20" style={{ backgroundColor: T.bgColor, color: T.textColor }}>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: T.borderColor + "20" }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse at 20% 0%, rgba(34,211,238,0.10) 0%, transparent 50%), radial-gradient(ellipse at 80% 0%, rgba(163,245,70,0.08) 0%, transparent 50%)",
        }} />
        <div className="relative max-w-7xl mx-auto px-4 py-12 md:py-20">
          <div className="flex flex-col items-center text-center gap-6">
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em]"
              style={{ backgroundColor: T.accentColor + "15", border: `1px solid ${T.accentColor}30`, color: T.accentColor }}>
              <Zap size={12} className="fill-current" /> LiTTree Agent OS
            </div>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-none" style={{ color: T.headerColor }}>
              Agent Roster
            </h1>
            <p className="text-base md:text-lg opacity-70 max-w-2xl leading-relaxed">
              Your AI agent team — code, growth, creative, social, music, security, data, and more. Click any agent to start working.
            </p>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-400" style={{ boxShadow: "0 0 6px #22c55e" }} />
              <span className="text-sm font-bold" style={{ color: "#22c55e" }}>{AGENTS.length} agents online</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── AGENT GRID ── */}
      <section className="max-w-7xl mx-auto px-4 mt-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
          {AGENTS.map((agent) => {
            const isActive = activeAgent === agent.id;
            return (
              <div
                key={agent.id}
                onMouseEnter={() => setActiveAgent(agent.id)}
                className="group rounded-2xl border p-6 cursor-pointer transition-all hover:-translate-y-1"
                style={{
                  backgroundColor: isActive ? agent.color + "08" : T.boxBg,
                  borderColor: isActive ? agent.color + "40" : T.borderColor + "20",
                  boxShadow: isActive ? `0 8px 32px ${agent.color}12` : "none",
                }}
              >
                {/* Avatar */}
                <div className="flex justify-center mb-4">
                  <AgentAvatar id={agent.id} size={64} />
                </div>

                {/* Name + tag */}
                <div className="text-center mb-3">
                  <div className="font-black text-base leading-tight" style={{ color: T.headerColor }}>
                    {agent.name}
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest mt-1"
                    style={{ color: agent.color }}>
                    {agent.tag}
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  <span className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "#22c55e", boxShadow: "0 0 5px #22c55e" }} />
                  <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "#22c55e" }}>
                    online
                  </span>
                </div>

                {/* Role + desc */}
                <p className="text-xs font-bold text-center mb-1.5 opacity-80" style={{ color: T.textColor }}>
                  {agent.role}
                </p>
                <p className="text-[11px] text-center leading-relaxed mb-4 opacity-50" style={{ color: T.textMuted }}>
                  {agent.desc}
                </p>

                {/* Action */}
                <Link href={agent.href}
                  className="block w-full text-center rounded-xl py-2.5 text-xs font-bold transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: agent.color, color: "#000" }}>
                  Launch Agent
                </Link>
              </div>
            );
          })}
        </div>
      </section>

    </main>
  );
}
