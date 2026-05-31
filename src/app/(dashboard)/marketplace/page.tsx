"use client";

import { useState } from "react";
import Link from "next/link";

interface Bot {
  id: string;
  name: string;
  tag: string;
  tagColor: string;
  desc: string;
  author: string;
  rating: number;
  uses: string;
  avatar: string;
}

const BOTS: Bot[] = [
  { id: "code-champion", name: "Code Champion", tag: "DEV", tagColor: "cyan", desc: "Elite pair programmer. Debugs, reviews, and writes production code in any language. Your personal senior dev.", author: "LitLabs", rating: 4.9, uses: "1.2k", avatar: "👨‍💻" },
  { id: "social-dominator", name: "Social Dominator", tag: "SOCIAL", tagColor: "purple", desc: "Manages your online presence. Writes posts, engages followers, grows your brand 24/7.", author: "LitLabs", rating: 4.7, uses: "856", avatar: "🎭" },
  { id: "data-slayer", name: "Data Slayer", tag: "DATA", tagColor: "gold", desc: "Upload any dataset. Get charts, insights, and predictions in seconds. Your personal data scientist.", author: "LitLabs", rating: 4.5, uses: "634", avatar: "📊" },
  { id: "writing-coach", name: "Writing Coach", tag: "WRITING", tagColor: "cyan", desc: "Improve anything you write. Essays, emails, tweets, docs. Makes your words hit different.", author: "LitLabs", rating: 4.8, uses: "978", avatar: "✍️" },
  { id: "support-agent", name: "Support Agent", tag: "SUPPORT", tagColor: "purple", desc: "24/7 customer support automation. Handles tickets and escalations with human-level empathy.", author: "Community", rating: 4.6, uses: "543", avatar: "🎧" },
  { id: "trading-oracle", name: "Trading Oracle", tag: "FINANCE", tagColor: "green", desc: "Analyzes markets, spots trends, alerts on opportunities. Smart signals for elite builders.", author: "Community", rating: 4.3, uses: "412", avatar: "📈" },
];

function StarRating({ rating }: { rating: number }) {
  const stars = Array.from({ length: 5 }, (_, i) => {
    const fill = Math.min(1, Math.max(0, rating - i));
    return (
      <span key={i} className="relative text-[10px]">
        <span className="text-white/10">★</span>
        <span
          className="absolute inset-0 text-neon-cyan overflow-hidden"
          style={{ width: fill === 1 ? "100%" : fill === 0 ? "0%" : "50%" }}
        >
          ★
        </span>
      </span>
    );
  });
  return <span className="flex gap-0.5">{stars}</span>;
}

export default function MarketplacePage() {
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div className="max-w-7xl mx-auto pb-24 selection:bg-neon-cyan selection:text-black animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-8 mb-12 border-b border-white/5 pb-8">
        <div className="space-y-1">
          <div className="text-[10px] font-black text-neon-purple tracking-[0.5em] uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-purple animate-pulse" />
            Foundry_Core_v3.0.4
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl font-black uppercase tracking-tighter text-white">Bot <span className="gradient-text">Forge</span></h1>
          <p className="text-zinc-500 font-mono text-xs tracking-wider uppercase mt-1">Acquire specialized technical daemons for your CEO Operating System.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-black/60 border border-white/5 rounded-2xl p-1.5 shadow-inner">
            <button 
              onClick={() => setView("grid")} 
              className={`p-2.5 rounded-xl transition-all ${view === "grid" ? "bg-neon-cyan text-black shadow-[0_0_15px_rgba(0,242,254,0.3)]" : "text-zinc-600 hover:text-zinc-400"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            </button>
            <button 
              onClick={() => setView("list")} 
              className={`p-2.5 rounded-xl transition-all ${view === "list" ? "bg-neon-cyan text-black shadow-[0_0_15px_rgba(0,242,254,0.3)]" : "text-zinc-600 hover:text-zinc-400"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
          </div>
          <Link href="/builder" className="btn-primary px-8 py-3 text-xs font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(0,242,254,0.2)]">
            + INITIALIZE_FORGE
          </Link>
        </div>
      </div>

      {/* Bot Grid/List */}
      <div className={`grid gap-6 ${view === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
        {BOTS.map((bot, i) => (
          <Link
            key={bot.id}
            href={`/gallery/${bot.id}`}
            className={`card group hover:border-white/20 transition-all duration-500 animate-antigravity hologram-glow ${view === "list" ? "flex items-center gap-8 p-6" : "p-8"}`}
            style={{ animationDelay: `${i * 0.2}s` }}
          >
            {/* Status Line */}
            <div className="absolute left-0 top-0 w-1 h-full bg-neon-cyan opacity-10 group-hover:opacity-100 transition-opacity" />
            
            <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-black/40 border border-white/5 transition-all group-hover:scale-105 group-hover:border-neon-cyan/30 shadow-inner ${view === "list" ? "w-16 h-16 sm:w-24 sm:h-24 text-3xl sm:text-5xl" : "w-20 h-20 text-5xl mb-8"}`}>
              {bot.avatar}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className={`font-heading font-black group-hover:text-neon-cyan transition-colors uppercase tracking-tight truncate ${view === "list" ? "text-xl sm:text-2xl" : "text-xl"}`}>
                  {bot.name}
                </h3>
                <span className={`badge badge-${bot.tagColor} shrink-0 text-[8px] font-black px-2 py-0.5 shadow-[0_0_10px_rgba(255,255,255,0.05)]`}>{bot.tag}</span>
              </div>

              <p className={`text-zinc-500 font-medium leading-relaxed group-hover:text-zinc-300 transition-colors ${view === "list" ? "text-sm sm:text-base line-clamp-2" : "text-sm line-clamp-3 mb-10"}`}>
                {bot.desc}
              </p>

              <div className="flex items-center justify-between pt-6 border-t border-white/5 font-mono text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-2">
                    <StarRating rating={bot.rating} />
                    <span className="text-zinc-400">{bot.rating}</span>
                  </span>
                  <div className="h-3 w-px bg-zinc-800" />
                  <span>BY_{bot.author.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-2 text-neon-cyan/60">
                  <span className="w-1 h-1 rounded-full bg-neon-cyan animate-pulse" />
                  {bot.uses} OPS
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer Call to Action */}
      <div className="mt-20 glass-panel p-10 sm:p-16 border-white/5 relative overflow-hidden text-center">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-neon-purple/40 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(155,81,224,0.05)_0%,transparent_70%)]" />
        
        <div className="relative z-10 max-w-2xl mx-auto space-y-6">
          <div className="text-[10px] font-black text-neon-purple tracking-[0.5em] uppercase">Architecture_Scaffolding</div>
          <h2 className="font-heading text-3xl sm:text-4xl font-black uppercase tracking-tighter text-white">Can&apos;t find the daemon you need?</h2>
          <p className="text-zinc-500 font-medium text-sm sm:text-base leading-relaxed">
            Construct a proprietary AI model from the ground up using the Agent Forge. Tailored persona matrixes, technical skillsets, and secure deployment.
          </p>
          <div className="pt-4">
            <Link href="/builder" className="btn-primary px-12 py-4 text-xs font-black uppercase tracking-[0.3em] bg-gradient-to-r from-neon-purple to-indigo-600 shadow-[0_0_30px_rgba(155,81,224,0.2)]">
              Initialize_Custom_Forge →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
