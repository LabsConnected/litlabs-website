"use client";

import { useState } from "react";
import Link from "next/link";

interface Agent {
  id: string;
  name: string;
  tag: string;
  tagColor: string;
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
    tag: "DEVELOPMENT",
    tagColor: "cyan",
    desc: "Elite pair programmer. Debugs, reviews, and writes production code in any language. Your personal senior dev.",
    author: "LitLabs",
    rating: 4.9,
    uses: "1.2k",
    personality: "Sharp, direct, solution-focused. Thinks in algorithms.",
    avatar: "👨‍💻",
  },
  {
    id: "social-dominator",
    name: "Social Dominator",
    tag: "SOCIAL",
    tagColor: "purple",
    desc: "Manages your online presence. Writes posts, engages followers, grows your brand 24/7. Knows what goes viral.",
    author: "LitLabs",
    rating: 4.7,
    uses: "856",
    personality: "Witty, trendy, always knows what's popping.",
    avatar: "🎭",
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    tag: "DATA",
    tagColor: "gold",
    desc: "Upload any dataset. Get charts, insights, and predictions in seconds. Your personal data scientist.",
    author: "LitLabs",
    rating: 4.5,
    uses: "634",
    personality: "Analytical, precise, loves a good spreadsheet.",
    avatar: "📊",
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    tag: "CREATIVE",
    tagColor: "cyan",
    desc: "Improve anything you write. Essays, emails, tweets, docs. Makes your words hit different.",
    author: "LitLabs",
    rating: 4.8,
    uses: "978",
    personality: "Encouraging, articulate, gentle but honest editor.",
    avatar: "✍️",
  },
  {
    id: "support-agent",
    name: "Support Agent",
    tag: "SUPPORT",
    tagColor: "purple",
    desc: "24/7 customer support automation. Handles FAQs, tickets, and escalations with human-level empathy.",
    author: "Community",
    rating: 4.6,
    uses: "543",
    personality: "Patient, helpful, never gets frustrated.",
    avatar: "🎧",
  },
  {
    id: "trading-bot",
    name: "Trading Oracle",
    tag: "FINANCE",
    tagColor: "green",
    desc: "Analyzes markets, spots trends, alerts on opportunities. Not financial advice, but smart signals.",
    author: "Community",
    rating: 4.3,
    uses: "412",
    personality: "Calculated, calm under pressure, risk-aware.",
    avatar: "📈",
  },
];

const CATEGORIES = ["ALL", "DEVELOPMENT", "SOCIAL", "DATA", "CREATIVE", "SUPPORT", "FINANCE"];

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
    <div className="min-h-screen bg-cyber-bg">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-cyber-border bg-cyber-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="text-lg font-bold tracking-wider text-neon-cyan text-glow-cyan">
            LITLABS<span className="text-neon-purple">.AI</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-text-secondary hover:text-neon-cyan transition-colors">
              Sign In
            </Link>
            <Link href="/register" className="btn-primary text-sm">Get Started</Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-12">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="mb-3 text-4xl font-bold">
            Agent <span className="gradient-text">Gallery</span>
          </h1>
          <p className="text-text-secondary max-w-lg mx-auto">
            Browse, try, and deploy AI agents built by LitLabs and the community.
          </p>
        </div>

        {/* Search + Filter */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <input
            className="input max-w-sm"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActive(cat)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  active === cat
                    ? "bg-neon-cyan text-cyber-bg"
                    : "border border-cyber-border text-text-secondary hover:border-neon-cyan/40 hover:text-neon-cyan"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="card group cursor-pointer"
              onClick={() => setSelected(bot)}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{bot.avatar}</span>
                <span className={`badge badge-${bot.tagColor}`}>{bot.tag}</span>
              </div>
              <h3 className="text-lg font-semibold group-hover:text-neon-cyan transition-colors mb-1">
                {bot.name}
              </h3>
              <p className="text-sm text-text-secondary mb-4 line-clamp-2">{bot.desc}</p>
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>by {bot.author}</span>
                <span>★ {bot.rating} · {bot.uses} uses</span>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="card text-center py-16">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold mb-2">No agents found</h3>
            <p className="text-text-secondary text-sm">Try a different search or category.</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="card max-w-lg w-full relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelected(null)}
              className="absolute top-4 right-4 text-text-muted hover:text-white text-xl"
            >
              ✕
            </button>

            <div className="flex items-center gap-4 mb-4">
              <span className="text-5xl">{selected.avatar}</span>
              <div>
                <h2 className="text-xl font-bold">{selected.name}</h2>
                <span className={`badge badge-${selected.tagColor}`}>{selected.tag}</span>
              </div>
            </div>

            <p className="text-text-secondary text-sm mb-4">{selected.desc}</p>

            <div className="bg-cyber-surface-2 rounded-lg p-3 mb-4">
              <div className="text-xs text-text-muted mb-1">Personality</div>
              <div className="text-sm">&ldquo;{selected.personality}&rdquo;</div>
            </div>

            <div className="flex items-center justify-between text-sm text-text-muted mb-6">
              <span>by {selected.author}</span>
              <span>★ {selected.rating} · {selected.uses} uses</span>
            </div>

            <div className="flex gap-3">
              <Link
                href={`/gallery/${selected.id}`}
                className="btn-primary flex-1 text-center"
              >
                Chat Now →
              </Link>
              <Link href="/register" className="btn-secondary flex-1 text-center">
                Build Copy
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
