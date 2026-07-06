"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Terminal,
  ScanLine,
  Rocket,
  Bot,
  Palette,
  Code2,
  Workflow,
  ShoppingBag,
  Users,
  Music,
  Gamepad2,
  ArrowRight,
  Sparkles,
  Send,
  Circle,
  Loader2,
  Brain,
  Zap,
  Hammer,
  BarChart3,
} from "lucide-react";

const SPECIALISTS = [
  {
    slug: "studio",
    label: "Studio",
    description: "Visuals, brand kits, UI mockups",
    icon: Palette,
    href: "/studio",
    color: "#f472b6",
    keywords: ["build", "design", "image", "video", "brand", "ui", "mockup", "poster"],
  },
  {
    slug: "code",
    label: "Code",
    description: "Components, APIs, auth, deploy",
    icon: Code2,
    href: "/code",
    color: "#22d3ee",
    keywords: ["code", "debug", "deploy", "api", "component", "fix", "build"],
  },
  {
    slug: "flow",
    label: "Flow",
    description: "Automations and workflows",
    icon: Workflow,
    href: "/flow",
    color: "#a78bfa",
    keywords: ["workflow", "automate", "flow", "trigger", "pipeline"],
  },
  {
    slug: "market",
    label: "Market",
    description: "Listings, pricing, offers",
    icon: ShoppingBag,
    href: "/marketplace",
    color: "#fbbf24",
    keywords: ["market", "sell", "price", "listing", "offer", "agent"],
  },
  {
    slug: "social",
    label: "Social",
    description: "Posts, captions, profiles",
    icon: Users,
    href: "/social",
    color: "#34d399",
    keywords: ["social", "post", "caption", "content", "profile", "follow"],
  },
  {
    slug: "music",
    label: "Music",
    description: "Audio, promo, soundscapes",
    icon: Music,
    href: "/music",
    color: "#60a5fa",
    keywords: ["music", "audio", "song", "promo", "sound"],
  },
  {
    slug: "games",
    label: "Games",
    description: "Game ideas and emulators",
    icon: Gamepad2,
    href: "/games",
    color: "#f87171",
    keywords: ["game", "play", "emulator", "clips"],
  },
  {
    slug: "terminal",
    label: "Terminal",
    description: "Command center and shell",
    icon: Terminal,
    href: "/lit-console",
    color: "#34d399",
    keywords: ["terminal", "shell", "command", "scan", "run"],
  },
];

const SUGGESTIONS = [
  "Build me a landing page",
  "Create a music promo post",
  "Scan my site and tell me what sucks",
  "Make an AI agent for selling beats",
];

function routePrompt(prompt: string) {
  const lower = prompt.toLowerCase();
  const match = SPECIALISTS.slice().sort((a, b) => {
    const aMatch = a.keywords.filter((k) => lower.includes(k)).length;
    const bMatch = b.keywords.filter((k) => lower.includes(k)).length;
    return bMatch - aMatch;
  })[0];

  if (!match) return null;
  if (match.slug === "terminal") return "/lit-console";
  if (match.slug === "code") return "/code";
  return match.href;
}

export function LiTTreeCorePage() {
  const { resolvedColors: T } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=/littree`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: "director",
          message: prompt,
          history: [],
        }),
      });
      const data = await res.json();
      const target = routePrompt(prompt) || "/littree";
      setRoute(target);
      if (data.response || data.text) {
        const qs = new URLSearchParams();
        qs.set("prompt", prompt);
        qs.set("from", "littree");
        router.push(`${target}?${qs.toString()}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen pb-12" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <section className="relative overflow-hidden border-b" style={{ borderColor: T.borderColor + "20" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at top left, rgba(34,211,238,0.12), transparent 35%), radial-gradient(circle at top right, rgba(52,211,153,0.12), transparent 30%)",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 py-12 md:py-20">
          <div className="flex flex-col items-center text-center gap-6">
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em]"
              style={{
                backgroundColor: T.accentColor + "12",
                border: `1px solid ${T.accentColor}30`,
                color: T.accentColor,
              }}
            >
              <Circle size={10} className="fill-current" /> Flagship System Agent
            </div>
            <h1 className="text-4xl md:text-7xl font-black tracking-tight" style={{ color: T.headerColor }}>
              LiTTree Core
            </h1>
            <p className="max-w-2xl text-base md:text-xl opacity-75">
              Your main AI brain for building, creating, selling, and automating. Type what you want and LiTTree routes it to the right branch.
            </p>

            <form onSubmit={handleSubmit} className="relative w-full max-w-2xl mt-4">
              <div
                className="flex items-center gap-3 rounded-2xl border px-4 py-4 md:px-5 md:py-5"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "30" }}
              >
                <Sparkles size={20} style={{ color: T.accentColor }} />
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="LiTTree, grow this idea..."
                  className="flex-1 bg-transparent outline-none text-sm md:text-base"
                  style={{ color: T.textColor }}
                />
                <button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  className="rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
              {route && (
                <div className="mt-2 text-left text-[11px] font-bold" style={{ color: T.textMuted }}>
                  Routing to: <span style={{ color: T.accentColor }}>{route}</span>
                </div>
              )}
            </form>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  className="rounded-full px-3 py-1.5 text-[11px] font-bold transition hover:opacity-80"
                  style={{
                    backgroundColor: T.boxBg,
                    border: `1px solid ${T.borderColor}25`,
                    color: T.textMuted,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ActionCard href="/studio" icon={Palette} label="Build" color={T.accentColor} />
          <ActionCard href="/lit-console" icon={Terminal} label="Terminal" color="#34d399" />
          <ActionCard href="/code" icon={ScanLine} label="Scan Site" color="#22d3ee" />
          <ActionCard href="/marketplace" icon={Rocket} label="Launch" color="#fbbf24" />
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black" style={{ color: T.headerColor }}>
            Specialist Agents
          </h2>
          <Link
            href="/agents"
            className="text-xs font-bold flex items-center gap-1"
            style={{ color: T.accentColor }}
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SPECIALISTS.map((agent) => {
            const Icon = agent.icon;
            return (
              <Link
                key={agent.slug}
                href={agent.href}
                className="group rounded-2xl border p-4 transition hover:-translate-y-1"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "25" }}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ backgroundColor: agent.color + "15" }}
                  >
                    <Icon size={20} style={{ color: agent.color }} />
                  </div>
                  <ArrowRight
                    size={14}
                    className="opacity-0 group-hover:opacity-100 transition"
                    style={{ color: T.textMuted }}
                  />
                </div>
                <h3 className="mt-3 font-bold" style={{ color: T.headerColor }}>
                  {agent.label}
                </h3>
                <p className="text-xs mt-1 opacity-60" style={{ color: T.textColor }}>
                  {agent.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-10">
        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: "#34d399" + "15" }}
            >
              <Brain size={20} style={{ color: "#34d399" }} />
            </div>
            <div>
              <h3 className="font-bold" style={{ color: T.headerColor }}>
                What LiTTree can do
              </h3>
              <p className="text-sm mt-1 opacity-75 leading-relaxed" style={{ color: T.textColor }}>
                LiTTree Core is your AI operating system. It can route tasks to specialist agents, remember your projects, help you plan offers and funnels, generate component ideas, and navigate the platform for you. Grow one idea at a time.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ActionCard({
  href,
  icon: Icon,
  label,
  color,
}: {
  href: string;
  icon: typeof Bot;
  label: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border px-4 py-3 transition hover:-translate-y-0.5"
      style={{ backgroundColor: "transparent", borderColor: color + "30" }}
    >
      <Icon size={18} style={{ color }} />
      <span className="text-sm font-bold" style={{ color }}>
        {label}
      </span>
    </Link>
  );
}
