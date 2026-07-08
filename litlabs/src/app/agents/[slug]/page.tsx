"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS_BY_SLUG, CORE_AGENTS } from "@/lib/agent-data";
import { AGENT_AVATAR_META } from "@/lib/avatars";
import {
  Bot,
  Sparkles,
  ArrowLeft,
  Star,
  Download,
  MessageSquare,
  Check,
  Zap,
} from "lucide-react";

const LEGACY_SLUGS = new Set(["jarvis", "littree"]);

export default function AgentPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const agent = slug ? AGENTS_BY_SLUG[slug] : null;

  useEffect(() => {
    if (!slug || LEGACY_SLUGS.has(slug)) {
      router.replace("/studio?tool=chat");
    }
  }, [slug, router]);

  if (!slug || LEGACY_SLUGS.has(slug)) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor, color: T.textColor }}
      >
        <div className="text-center space-y-3">
          <Bot className="mx-auto h-8 w-8" style={{ color: T.accentColor }} />
          <div className="text-lg font-black">LiTTree is now your main agent</div>
          <div className="text-xs opacity-70" style={{ color: T.textMuted }}>
            Redirecting from legacy agent page...
          </div>
        </div>
      </main>
    );
  }

  if (!agent) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: T.bgColor, color: T.textColor }}
      >
        <div className="text-center space-y-4 max-w-md">
          <Bot className="mx-auto h-10 w-10" style={{ color: T.accentColor }} />
          <div className="text-xl font-black">Agent coming soon</div>
          <div className="text-sm" style={{ color: T.textMuted }}>
            This agent is not available yet. Browse the agents that are ready, or open LiTTree Core to start building.
          </div>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition hover:opacity-90"
              style={{ backgroundColor: T.boxBg, color: T.textColor, border: `1px solid ${T.borderColor}30` }}
            >
              <ArrowLeft className="h-4 w-4" /> Browse agents
            </Link>
            <Link
              href="/studio?tool=chat"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition hover:opacity-90"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <MessageSquare className="h-4 w-4" /> Open LiTTree Core
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const avatar = AGENT_AVATAR_META[agent.slug] || AGENT_AVATAR_META["director"];
  const related = CORE_AGENTS.filter((a) => a.slug !== agent.slug).slice(0, 3);

  return (
    <main className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* Back link */}
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-xs font-bold mb-6 transition hover:opacity-80"
          style={{ color: T.textMuted }}
        >
          <ArrowLeft className="h-4 w-4" /> All agents
        </Link>

        {/* Hero card */}
        <div
          className="rounded-3xl border p-6 md:p-8 mb-8"
          style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}
        >
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div
              className="w-20 h-20 md:w-24 md:h-24 rounded-3xl flex items-center justify-center text-4xl shrink-0"
              style={{ backgroundColor: avatar.bg, border: `2px solid ${agent.color}40` }}
            >
              {avatar.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-2xl md:text-3xl font-black" style={{ color: T.textColor }}>
                  {agent.name}
                </span>
                <span
                  className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
                  style={{ backgroundColor: `${agent.color}15`, color: agent.color, border: `1px solid ${agent.color}30` }}
                >
                  {agent.role}
                </span>
              </div>
              <p className="text-sm md:text-base mb-4 leading-relaxed" style={{ color: T.textMuted }}>
                {agent.description}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-xs font-bold" style={{ color: T.textMuted }}>
                <span className="flex items-center gap-1" style={{ color: "#fbbf24" }}>
                  <Star className="h-3.5 w-3.5 fill-current" /> {agent.rating}
                </span>
                <span className="flex items-center gap-1">
                  <Download className="h-3.5 w-3.5" /> {agent.installs.toLocaleString()} installs
                </span>
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" style={{ color: agent.color }} /> {agent.personality}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full md:w-auto shrink-0">
              <Link
                href={`/studio?agent=${agent.slug}`}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition hover:scale-[1.02]"
                style={{ backgroundColor: agent.color, color: T.bgColor }}
              >
                <Zap className="h-4 w-4" /> Open in Studio
              </Link>
              <button
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition hover:scale-[1.02]"
                style={{ backgroundColor: `${T.borderColor}20`, color: T.textColor, border: `1px solid ${T.borderColor}30` }}
              >
                <Download className="h-4 w-4" /> Install Agent
              </button>
            </div>
          </div>
        </div>

        {/* Capabilities + examples */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}
          >
            <div className="text-xs font-black uppercase tracking-[0.15em] mb-4" style={{ color: T.accentColor }}>
              Capabilities
            </div>
            <ul className="space-y-2">
              {agent.capabilities.map((cap) => (
                <li key={cap} className="flex items-start gap-2 text-sm" style={{ color: T.textMuted }}>
                  <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: agent.color }} />
                  {cap}
                </li>
              ))}
            </ul>
          </div>
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}
          >
            <div className="text-xs font-black uppercase tracking-[0.15em] mb-4" style={{ color: T.accentColor }}>
              Example prompts
            </div>
            <ul className="space-y-2">
              {agent.examples.map((ex) => (
                <li key={ex} className="flex items-start gap-2 text-sm" style={{ color: T.textMuted }}>
                  <MessageSquare className="h-4 w-4 shrink-0 mt-0.5" style={{ color: agent.color }} />
                  &ldquo;{ex}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Related agents */}
        <div>
          <div className="text-xs font-black uppercase tracking-[0.15em] mb-4" style={{ color: T.accentColor }}>
            Related agents
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {related.map((a) => {
              const av = AGENT_AVATAR_META[a.slug] || AGENT_AVATAR_META["director"];
              return (
                <Link
                  key={a.slug}
                  href={`/agents/${a.slug}`}
                  className="flex items-center gap-3 p-4 rounded-2xl border transition hover:scale-[1.02]"
                  style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                    style={{ backgroundColor: av.bg }}
                  >
                    {av.emoji}
                  </div>
                  <div>
                    <div className="text-sm font-black" style={{ color: T.textColor }}>{a.name}</div>
                    <div className="text-[10px]" style={{ color: T.textMuted }}>{a.role}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
