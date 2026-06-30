"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { ShoppingBag, Zap, ArrowRight, Coins } from "lucide-react";

const COIN_PACKS = [
  { id: "starter", coins: 500, price: "$1", label: "Starter", color: "#00f0ff" },
  { id: "popular", coins: 1200, price: "$5", label: "Popular", popular: true, color: "#ff00a0" },
  { id: "pro", coins: 3000, price: "$10", label: "Pro", color: "#8b5cf6" },
];

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "developer", label: "Developer" },
  { id: "marketing", label: "Marketing" },
  { id: "content", label: "Content" },
  { id: "general", label: "General" },
];

type PreviewAgent = {
  slug: string;
  name: string;
  category: string;
  description: string;
  price: number;
  emoji: string;
};

const PREVIEW_AGENTS: PreviewAgent[] = [
  { slug: "director", name: "Director", category: "general", description: "Orchestrates tasks across your agent workforce. The brain of your operation.", price: 0, emoji: "🎯" },
  { slug: "forge", name: "Forge", category: "developer", description: "Writes, debugs, and reviews code. TypeScript, Next.js, Supabase specialist.", price: 0, emoji: "💻" },
  { slug: "pulse", name: "Pulse", category: "marketing", description: "Plans content, grows your audience, and crafts SEO-optimized copy.", price: 0, emoji: "📱" },
  { slug: "pixel-forge", name: "Pixel Forge", category: "content", description: "Visual creative — images, brand identity, UI/UX, and art direction.", price: 50, emoji: "🎨" },
  { slug: "data-slayer", name: "Data Slayer", category: "developer", description: "Crunch numbers, find patterns, build dashboards and analytics.", price: 50, emoji: "📊" },
  { slug: "writer", name: "Writer", category: "content", description: "Crafts compelling copy, stories, scripts and marketing content.", price: 0, emoji: "✍️" },
];

const CATEGORY_COLOR: Record<string, string> = {
  developer: "#818cf8",
  marketing: "#34d399",
  content: "#f472b6",
  general: "#fbbf24",
  analytics: "#a78bfa",
};

export default function MarketplacePreview() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState("all");

  const agents = PREVIEW_AGENTS.filter((a) =>
    activeCategory === "all" ? true : a.category === activeCategory,
  );

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              backgroundColor: activeCategory === c.id ? `${T.accentColor}20` : `${T.boxBg}80`,
              border: `1px solid ${activeCategory === c.id ? T.accentColor + "50" : T.borderColor + "30"}`,
              color: activeCategory === c.id ? T.accentColor : T.textMuted,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const color = CATEGORY_COLOR[agent.category] || "#fbbf24";
          return (
            <div
              key={agent.slug}
              className="group relative rounded-xl border p-4 transition-all hover:scale-[1.01] cursor-pointer"
              style={{ backgroundColor: `${T.boxBg}80`, borderColor: `${color}20` }}
              onClick={() => router.push("/marketplace")}
            >
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                  style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
                >
                  {agent.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>
                    {agent.name}
                  </div>
                  <div
                    className="text-[10px] uppercase tracking-wider font-bold mt-0.5"
                    style={{ color: color + "cc" }}
                  >
                    {agent.category}
                  </div>
                </div>
                <span
                  className="text-[10px] font-black px-2 py-1 rounded-lg shrink-0"
                  style={{ backgroundColor: `${color}15`, color }}
                >
                  {agent.price === 0 ? "FREE" : `${agent.price} LBC`}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: T.textMuted }}>
                {agent.description}
              </p>
              <button
                className="mt-3 w-full py-1.5 rounded-lg text-xs font-bold transition-all opacity-0 group-hover:opacity-100"
                style={{ backgroundColor: `${color}15`, color }}
              >
                <Zap size={11} className="inline mr-1" />
                Get Agent
              </button>
            </div>
          );
        })}
      </div>

      {/* Coin packs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Coins size={14} style={{ color: T.textMuted }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
            Coin Packs
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {COIN_PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick={() => router.push("/marketplace?tab=plans")}
              className="relative p-3 rounded-xl border text-center transition-all hover:scale-[1.02]"
              style={{
                backgroundColor: `${pack.color}08`,
                borderColor: pack.popular ? pack.color + "50" : pack.color + "20",
              }}
            >
              {pack.popular && (
                <span
                  className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-black px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: pack.color, color: "#000" }}
                >
                  POPULAR
                </span>
              )}
              <div className="text-lg font-black" style={{ color: pack.color }}>
                {pack.coins.toLocaleString()}
              </div>
              <div className="text-[10px] font-bold" style={{ color: T.textMuted }}>
                LitBits
              </div>
              <div className="text-xs font-black mt-1" style={{ color: T.textColor }}>
                {pack.price}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* View full link */}
      <Link
        href="/marketplace"
        className="flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-bold transition-all hover:bg-white/5"
        style={{ borderColor: T.borderColor + "30", color: T.textMuted }}
      >
        <ShoppingBag size={13} />
        View full marketplace
        <ArrowRight size={13} />
      </Link>
    </div>
  );
}
