"use client";
import { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

interface Agent {
  id: string;
  name: string;
  tag: string;
  desc: string;
  author: string;
  rating: number;
  uses: string;
  personality: string;
  avatar: string;
}

const AGENTS: Agent[] = [
  {
    id: "code-champion",
    name: "Code Champion",
    tag: "DEV",
    desc: "Elite pair programmer. Debugs, reviews, and writes production code in any language.",
    author: "LitLabs",
    rating: 4.9,
    uses: "1.2k",
    personality: "Sharp, direct, solution-focused.",
    avatar: "👨‍💻",
  },
  {
    id: "social-dominator",
    name: "Social Dominator",
    tag: "SOCIAL",
    desc: "Manages your online presence. Writes posts, engages followers, grows your brand 24/7.",
    author: "LitLabs",
    rating: 4.7,
    uses: "856",
    personality: "Witty, trendy, knows what goes viral.",
    avatar: "🎭",
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    tag: "DATA",
    desc: "Upload any dataset. Get charts, insights, and predictions in seconds.",
    author: "LitLabs",
    rating: 4.5,
    uses: "634",
    personality: "Analytical, precise, loves patterns.",
    avatar: "📊",
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    tag: "CREATIVE",
    desc: "Improve anything you write. Essays, emails, tweets, docs. Makes your words hit different.",
    author: "LitLabs",
    rating: 4.8,
    uses: "978",
    personality: "Encouraging, articulate, honest editor.",
    avatar: "✍️",
  },
  {
    id: "support-agent",
    name: "Support Agent",
    tag: "SUPPORT",
    desc: "24/7 customer support. Handles FAQs, tickets, and escalations with human-level empathy.",
    author: "Community",
    rating: 4.6,
    uses: "543",
    personality: "Patient, helpful, never gets frustrated.",
    avatar: "🎧",
  },
  {
    id: "trading-oracle",
    name: "Trading Oracle",
    tag: "FINANCE",
    desc: "Analyzes markets, spots trends, alerts on opportunities. Smart signals, not financial advice.",
    author: "Community",
    rating: 4.3,
    uses: "412",
    personality: "Calculated, calm under pressure.",
    avatar: "📈",
  },
];

const CATEGORIES = ["ALL", "DEV", "SOCIAL", "DATA", "CREATIVE", "SUPPORT", "FINANCE"];
const TAG_COLORS: Record<string, string> = {
  DEV: "blue", SOCIAL: "purple", DATA: "amber", CREATIVE: "cyan",
  SUPPORT: "green", FINANCE: "emerald",
};

export default function GalleryPage() {
  const [active, setActive] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Agent | null>(null);

  const filtered = AGENTS.filter((a) => {
    const matchCat = active === "ALL" || a.tag === active;
    const matchSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.desc.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />

      <div className="mx-auto max-w-6xl px-4 pt-8 pb-16">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-3xl font-extrabold sm:text-5xl">
            Agent <span className="gradient-text">Gallery</span>
          </h1>
          <p className="text-zinc-500 max-w-lg mx-auto">
            Browse and deploy ready-made AI agents. Each one is built and tested by the LitLabs team.
          </p>
        </div>

        {/* Search + Filter */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">🔍</span>
            <input
              className="input pl-10"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActive(cat)}
                className={`shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                  active === cat
                    ? "bg-blue-600 text-white"
                    : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-6 hover:border-white/20 hover:bg-white/[0.05] transition-all cursor-pointer group"
              onClick={() => setSelected(bot)}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl group-hover:scale-105 transition-transform">
                  {bot.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-bold text-white truncate">{bot.name}</h3>
                  </div>
                  <span className="badge">bot.tag</span>
                </div>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed mb-4 line-clamp-2">{bot.desc}</p>
              <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs text-zinc-500">
                <span className="flex items-center gap-1">★ {bot.rating}</span>
                <span>{bot.uses} uses</span>
                <span>by {bot.author}</span>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-lg font-bold text-zinc-400 mb-2">No agents found</h3>
            <p className="text-sm text-zinc-600">Try a different search or category.</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative w-full sm:max-w-lg bg-[#12121a] border border-white/10 rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelected(null)}
              className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-zinc-400 hover:text-white transition-colors"
            >
              ✕
            </button>

            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-5xl mx-auto mb-4">
                {selected.avatar}
              </div>
              <span className="badge mb-2">selected.tag</span>
              <h2 className="text-2xl font-extrabold text-white">{selected.name}</h2>
              <p className="text-xs text-zinc-500 mt-1">by {selected.author}</p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">What it does</div>
                <p className="text-sm text-zinc-300 leading-relaxed">{selected.desc}</p>
              </div>
              <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-4">
                <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Personality</div>
                <p className="text-sm text-white italic">&ldquo;{selected.personality}&rdquo;</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="text-zinc-500 mb-1">Rating</div>
                  <div className="text-white font-bold">★ {selected.rating}</div>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="text-zinc-500 mb-1">Uses</div>
                  <div className="text-white font-bold">{selected.uses}</div>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <div className="text-zinc-500 mb-1">Status</div>
                  <div className="text-green-400 font-bold">Online</div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Link
                href={`/gallery/${selected.id}`}
                className="btn-primary flex-1 text-center"
              >
                Deploy Agent →
              </Link>
              <button
                onClick={() => setSelected(null)}
                className="btn-secondary flex-1 text-center"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
