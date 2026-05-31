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
    tag: "DEV",
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
    id: "trading-oracle",
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

const CATEGORIES = ["ALL", "DEV", "SOCIAL", "DATA", "CREATIVE", "SUPPORT", "FINANCE"];

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
    <div className="min-h-screen bg-cyber-bg selection:bg-neon-cyan/30 animate-fade-in">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 pt-8 pb-20 sm:px-6 sm:py-20">
        {/* Header */}
        <div className="mb-12 sm:mb-20 text-center sm:text-left border-b border-white/5 pb-12">
          <div className="inline-block text-[10px] font-black text-neon-cyan tracking-[0.5em] uppercase mb-4 flex items-center justify-center sm:justify-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
            Registry_Module_v3.0.4
          </div>
          <h1 className="mb-4 text-4xl sm:text-7xl font-black font-heading uppercase tracking-tighter text-white">
            AGENT <span className="gradient-text drop-shadow-[0_0_30px_rgba(0,242,254,0.2)]">GALLERY</span>
          </h1>
          <p className="text-zinc-500 max-w-2xl font-medium text-sm sm:text-lg uppercase tracking-wide font-mono">
            Browse and deploy elite AI champions. Each node is optimized for the CEO Operating System.
          </p>
        </div>

        {/* Search + Filter */}
        <div className="mb-12 flex flex-col gap-6 p-6 glass-panel border-white/5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-neon-cyan/20 to-transparent" />
          
          <div className="flex flex-col lg:flex-row gap-6 justify-between items-center">
            {/* Search */}
            <div className="relative w-full lg:max-w-md group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-neon-cyan transition-colors">
                🔍
              </span>
              <input
                className="input pl-12 bg-black/40 border-white/5 focus:border-neon-cyan/40"
                placeholder="Search Registry..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Category filters */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap no-scrollbar scrollbar-hide w-full lg:w-auto">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActive(cat)}
                  className={`shrink-0 rounded-xl px-5 py-2.5 text-[10px] font-black tracking-[0.2em] transition-all uppercase min-h-[44px] ${
                    active === cat
                      ? "bg-neon-cyan text-black shadow-[0_0_20px_rgba(0,242,254,0.4)]"
                      : "bg-white/5 border border-white/5 text-zinc-500 hover:border-neon-cyan/30 hover:text-zinc-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Agent Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bot, i) => (
            <div
              key={bot.id}
              className="card group cursor-pointer relative overflow-hidden hover:border-neon-cyan/40 hover:shadow-[0_0_40px_rgba(0,242,254,0.1)] transition-all duration-500 p-8 animate-antigravity hologram-glow"
              style={{ animationDelay: `${i * 0.15}s` }}
              onClick={() => setSelected(bot)}
            >
              {/* Corner Accents */}
              <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-white/5 group-hover:border-neon-cyan/40 transition-colors" />
              
              <div className="flex flex-col items-center text-center">
                <div className="w-24 h-24 rounded-3xl bg-black/40 border border-white/10 flex items-center justify-center text-6xl mb-8 group-hover:scale-110 group-hover:border-neon-cyan/20 transition-all duration-700 shadow-inner">
                  {bot.avatar}
                </div>
                
                <div className="badge badge-cyan mb-4 text-[8px] font-black px-3 py-1 shadow-[0_0_10px_rgba(0,242,254,0.1)]">
                  {bot.tag}
                </div>
                
                <h3 className="text-2xl font-black group-hover:text-neon-cyan transition-colors mb-3 font-heading uppercase tracking-tighter text-white">
                  {bot.name}
                </h3>
                
                <p className="text-sm text-zinc-500 font-medium line-clamp-2 leading-relaxed mb-8 group-hover:text-zinc-300 transition-colors">
                  {bot.desc}
                </p>

                <div className="w-full pt-6 border-t border-white/5 flex items-center justify-between font-mono text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                  <span className="flex items-center gap-1.5">
                    <span className="text-neon-cyan text-xs">★</span> {bot.rating}
                  </span>
                  <span>{bot.uses} DEPLOYMENTS</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="card text-center py-24 border-dashed border-white/10 bg-transparent">
            <div className="text-6xl mb-8 grayscale opacity-20 animate-pulse">🔍</div>
            <h3 className="text-xl font-black font-heading mb-3 uppercase tracking-widest text-zinc-700">No matches in Registry</h3>
            <p className="text-zinc-600 text-sm font-bold uppercase tracking-widest">
              Refine your search parameters or select a different sector.
            </p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/90 backdrop-blur-2xl animate-fade-in"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative w-full sm:max-w-2xl bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl p-8 sm:p-16 overflow-y-auto max-h-[100dvh] sm:max-h-[90vh] shadow-[0_0_100px_rgba(0,0,0,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HUD Corner Accents */}
            <div className="absolute top-0 left-0 w-20 h-20 border-t-4 border-l-4 border-neon-cyan/20 rounded-tl-3xl" />
            <div className="absolute top-0 right-0 w-20 h-20 border-t-4 border-r-4 border-white/5 rounded-tr-3xl" />
            
            <button
              onClick={() => setSelected(null)}
              className="absolute top-6 right-6 w-12 h-12 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-zinc-500 hover:text-white hover:border-neon-cyan/40 hover:bg-white/10 transition-all z-20"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="relative z-10">
              {/* Avatar + Name */}
              <div className="flex flex-col items-center text-center mb-12">
                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-[2.5rem] bg-black/60 border border-neon-cyan/20 flex items-center justify-center text-6xl sm:text-8xl mb-8 shadow-2xl animate-antigravity">
                  {selected.avatar}
                </div>
                <div className="space-y-2">
                  <div className="badge badge-cyan px-4 py-1 text-[10px] font-black tracking-[0.3em]">
                    NODE_ID: {selected.id.toUpperCase()}
                  </div>
                  <h2 className="text-3xl sm:text-5xl font-black font-heading uppercase tracking-tighter text-white">
                    {selected.name}
                  </h2>
                  <div className="text-[10px] font-bold text-zinc-600 font-mono tracking-[0.4em] uppercase">
                    Authorized_by_LitLabs_v3
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-10 mb-12">
                <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.4em] mb-4 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-zinc-600" />
                    Technical_Capability
                  </div>
                  <p className="text-base sm:text-lg text-zinc-300 font-medium leading-relaxed">{selected.desc}</p>
                </div>

                <div className="p-6 rounded-2xl bg-gradient-to-br from-neon-cyan/5 to-transparent border border-neon-cyan/10">
                  <div className="text-[10px] font-black text-neon-cyan uppercase tracking-[0.4em] mb-4 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-neon-cyan shadow-[0_0_8px_var(--neon-cyan)]" />
                    Persona_Matrix
                  </div>
                  <div className="text-lg sm:text-xl font-black italic text-white tracking-tight">
                    &ldquo;{selected.personality}&rdquo;
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 font-mono text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 text-center">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-zinc-700 mb-1">Rank</div>
                    <div className="text-neon-cyan text-sm">TOP_TIER</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-zinc-700 mb-1">Status</div>
                    <div className="text-green-400 text-sm">ONLINE</div>
                  </div>
                  <div className="hidden sm:block p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-zinc-700 mb-1">Uptime</div>
                    <div className="text-white text-sm">99.9%</div>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href={`/gallery/${selected.id}`}
                  className="btn-primary flex-1 py-5 text-center text-xs font-black uppercase tracking-[0.3em] bg-gradient-to-r from-neon-cyan to-blue-600 shadow-[0_0_40px_rgba(0,242,254,0.2)]"
                >
                  INITIALIZE_DEPLOYMENT →
                </Link>
                <button
                  onClick={() => setSelected(null)}
                  className="btn-secondary flex-1 py-5 text-center text-xs font-black uppercase tracking-[0.3em] border-white/10 hover:bg-white/5"
                >
                  ABORT_PREVIEW
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
