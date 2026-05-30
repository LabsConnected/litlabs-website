"use client";

import { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

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
    <div className="min-h-screen bg-cyber-bg selection:bg-neon-cyan/30">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 pt-8 pb-8 sm:px-6 sm:py-20">
        {/* Header */}
        <div className="mb-8 sm:mb-16 text-center sm:text-left">
          <div className="inline-block text-[10px] font-bold text-neon-cyan tracking-[0.3em] uppercase mb-1 sm:mb-2">
            Champion_Registry_v3.0
          </div>
          <h1 className="mb-2 sm:mb-4 text-3xl sm:text-6xl font-bold font-heading uppercase tracking-tight">
            AGENT <span className="gradient-text">GALLERY</span>
          </h1>
          <p className="text-text-secondary max-w-2xl font-medium text-sm sm:text-lg">
            Browse and deploy elite AI champions. Each agent is pre-configured with specialized cyber-daemons and dual-agent workflows.
          </p>
        </div>

        {/* Search + Filter */}
        <div className="mb-8 sm:mb-12 flex flex-col gap-4 sm:gap-6 p-3 sm:p-6 glass-panel border-white/5">
          {/* Search */}
          <div className="relative w-full sm:max-w-md">
            <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-text-muted opacity-50 text-sm">
              🔍
            </span>
            <input
              className="input pl-10 sm:pl-12"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Category filters — horizontally scrollable on mobile */}
          <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap no-scrollbar scrollbar-hide">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActive(cat)}
                className={`shrink-0 rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] font-bold tracking-widest transition-all uppercase min-h-[36px] ${
                  active === cat
                    ? "bg-neon-cyan text-cyber-bg shadow-[0_0_15px_rgba(0,242,254,0.3)]"
                    : "bg-white/5 border border-white/5 text-text-muted hover:border-neon-cyan/40 hover:text-neon-cyan"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Agent Grid: 1 col mobile, 2 col tablet, 3 col desktop */}
        <div className="grid grid-cols-1 gap-3 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="card group cursor-pointer relative overflow-hidden hover:border-neon-cyan/40 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(0,242,254,0.1)] transition-all duration-300 p-3 sm:p-6"
              onClick={() => setSelected(bot)}
            >
              {/* Compact mobile card: avatar + name + tag + rating in tight layout */}
              <div className="flex items-center gap-3 mb-2 sm:mb-6 sm:block">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center text-xl sm:text-3xl shrink-0 group-hover:scale-110 transition-transform duration-500">
                  {bot.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 sm:mb-2">
                    <h3 className="text-sm sm:text-xl font-bold group-hover:text-neon-cyan transition-colors font-heading uppercase tracking-tight truncate">
                      {bot.name}
                    </h3>
                    <span className={`badge badge-${bot.tagColor} shrink-0`}>{bot.tag}</span>
                  </div>
                  {/* Rating visible on mobile under name, hidden from main desktop layout */}
                  <div className="flex sm:hidden items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    <span className="text-neon-cyan">★</span> {bot.rating} · {bot.uses}
                  </div>
                </div>
              </div>
              {/* Full layout for sm+ */}
              <div className="hidden sm:block">
                <h3 className="text-xl font-bold group-hover:text-neon-cyan transition-colors mb-2 font-heading uppercase tracking-tight">
                  {bot.name}
                </h3>
                <p className="text-sm text-text-secondary mb-8 font-medium line-clamp-2 leading-relaxed">
                  {bot.desc}
                </p>
                <div className="flex items-center justify-between pt-4 border-t border-white/5 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="text-neon-cyan">★</span> {bot.rating}
                  </span>
                  <span>{bot.uses} DEPLOYMENTS</span>
                </div>
              </div>
              {/* Desc truncated on mobile */}
              <p className="sm:hidden text-xs text-text-secondary font-medium line-clamp-2 leading-relaxed">
                {bot.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="card text-center py-16 sm:py-24 border-dashed border-white/10">
            <div className="text-4xl sm:text-5xl mb-4 sm:mb-6 grayscale">🔍</div>
            <h3 className="text-lg sm:text-xl font-bold font-heading mb-2 uppercase">No matches in Matrix</h3>
            <p className="text-text-secondary text-xs sm:text-sm font-medium">
              Refine your search parameters or select a different sector.
            </p>
          </div>
        )}
      </div>

      {/* Detail Modal: full-screen on mobile, centered card on desktop */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xl animate-fade-in"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative w-full sm:max-w-xl bg-cyber-surface border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 sm:p-12 overflow-y-auto max-h-[100dvh] sm:max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient accent line */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neon-cyan to-transparent" />

            {/* Close button — 44px+ touch target */}
            <button
              onClick={() => setSelected(null)}
              className="absolute top-3 right-3 sm:top-6 sm:right-6 w-11 h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/5 text-text-muted hover:text-white hover:border-neon-cyan/40 hover:bg-white/10 transition-all"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Avatar + Name */}
            <div className="flex items-center gap-4 sm:gap-6 mb-6 sm:mb-8 pr-12 sm:pr-0">
              <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl sm:text-5xl shrink-0">
                {selected.avatar}
              </div>
              <div className="min-w-0">
                <h2 className="text-xl sm:text-3xl font-bold font-heading uppercase tracking-tight mb-1 truncate">
                  {selected.name}
                </h2>
                <span className={`badge badge-${selected.tagColor}`}>{selected.tag}</span>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-4 sm:space-y-6 mb-6 sm:mb-10">
              <div>
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1 sm:mb-2">
                  Capability_Description
                </div>
                <p className="text-sm text-text-secondary font-medium leading-relaxed">{selected.desc}</p>
              </div>

              <div className="p-3 sm:p-4 rounded-xl bg-black/40 border border-white/5">
                <div className="text-[10px] font-bold text-neon-cyan uppercase tracking-widest mb-1 sm:mb-2">
                  Persona_Matrix
                </div>
                <div className="text-xs sm:text-sm font-medium italic text-text-primary">
                  &ldquo;{selected.personality}&rdquo;
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">
                <span>FORGED BY: {selected.author.toUpperCase()}</span>
                <span className="flex items-center gap-4">
                  <span>RANK: ★ {selected.rating}</span>
                  <span>USAGE: {selected.uses}</span>
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Link
                href={`/gallery/${selected.id}`}
                className="btn-primary flex-1 py-3 sm:py-4 text-center text-xs sm:text-sm uppercase tracking-widest"
              >
                Deploy →
              </Link>
              <Link
                href="/login"
                className="btn-secondary flex-1 py-3 sm:py-4 text-center text-xs sm:text-sm uppercase tracking-widest"
              >
                Preview
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
