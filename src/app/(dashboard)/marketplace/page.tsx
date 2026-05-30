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
  { id: "code-champion", name: "Code Champion", tag: "DEV", tagColor: "cyan", desc: "AI pair programmer for any language. Debugs, reviews, and ships code.", author: "LitLabs", rating: 4.9, uses: "1.2k", avatar: "👨‍💻" },
  { id: "social-dominator", name: "Social Dominator", tag: "SOCIAL", tagColor: "purple", desc: "Auto-post, engage, and grow your audience across platforms.", author: "LitLabs", rating: 4.7, uses: "856", avatar: "🎭" },
  { id: "data-slayer", name: "Data Slayer", tag: "DATA", tagColor: "gold", desc: "Upload data, get insights instantly. Charts, predictions, analysis.", author: "LitLabs", rating: 4.5, uses: "634", avatar: "📊" },
  { id: "writing-coach", name: "Writing Coach", tag: "WRITING", tagColor: "cyan", desc: "Improve your writing with AI feedback. Essays, emails, tweets, docs.", author: "LitLabs", rating: 4.8, uses: "978", avatar: "✍️" },
  { id: "support-agent", name: "Support Agent", tag: "SUPPORT", tagColor: "purple", desc: "24/7 customer support automation with human-level empathy.", author: "Community", rating: 4.6, uses: "543", avatar: "🎧" },
  { id: "trading-oracle", name: "Trading Oracle", tag: "FINANCE", tagColor: "green", desc: "Automated trading strategies and market alerts.", author: "Community", rating: 4.3, uses: "412", avatar: "📈" },
];

function StarRating({ rating }: { rating: number }) {
  const stars = Array.from({ length: 5 }, (_, i) => {
    const fill = Math.min(1, Math.max(0, rating - i));
    return (
      <span key={i} className="relative text-xs">
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
  return <span className="flex">{stars}</span>;
}

export default function MarketplacePage() {
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div className="max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-[10px] font-bold text-neon-purple tracking-[0.4em] uppercase mb-2">Bot_Foundry_v3.0</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold uppercase tracking-tight">Bot <span className="gradient-text">Forge</span></h1>
          <p className="text-text-secondary font-medium text-sm mt-1">Acquire specialized daemons for your CEO workspace.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-black/40 border border-white/5 rounded-xl p-1">
            <button onClick={() => setView("grid")} className={`p-2 rounded-lg transition-all ${view === "grid" ? "bg-neon-cyan/20 text-neon-cyan" : "text-text-muted hover:text-text-secondary"}`} title="Grid View">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            </button>
            <button onClick={() => setView("list")} className={`p-2 rounded-lg transition-all ${view === "list" ? "bg-neon-cyan/20 text-neon-cyan" : "text-text-muted hover:text-text-secondary"}`} title="List View">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
          </div>
          <Link href="/builder" className="btn-primary text-xs px-5 py-2.5 uppercase tracking-widest">+ Forge</Link>
        </div>
      </div>

      {/* Featured Banner */}
      <Link href="/builder" className="block mb-8 p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-neon-cyan/10 via-neon-purple/10 to-neon-cyan/10 border border-neon-cyan/20 hover:border-neon-cyan/40 hover:shadow-[0_0_30px_rgba(0,242,254,0.08)] transition-all duration-300 group">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold text-neon-cyan tracking-[0.3em] uppercase mb-1">⚡ FEATURED</div>
            <h3 className="font-heading text-base sm:text-lg font-bold uppercase tracking-tight group-hover:text-neon-cyan transition-colors">Create your own agent in the Forge</h3>
            <p className="text-text-secondary text-xs font-medium mt-1">Design a custom AI daemon in 4 steps. No code required.</p>
          </div>
          <span className="btn-primary text-xs px-6 py-3 uppercase tracking-widest whitespace-nowrap">Enter Forge →</span>
        </div>
      </Link>

      {/* Bot Grid/List */}
      <div className={`grid gap-3 ${view === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
        {BOTS.map(bot => (
          <Link
            key={bot.id}
            href={`/gallery/${bot.id}`}
            className={`card group hover:border-neon-cyan/30 hover:shadow-[0_0_20px_rgba(0,242,254,0.04)] transition-all duration-300 ${view === "list" ? "flex items-center gap-4 p-3 sm:p-4" : "p-4"}`}
          >
            <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-white/5 border border-white/5 transition-colors group-hover:bg-white/10 group-hover:border-neon-cyan/20 ${view === "list" ? "w-12 h-12 sm:w-14 sm:h-14 text-2xl" : "w-full aspect-square max-w-[80px] mx-auto mb-4 text-3xl"}`}>
              {bot.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className={`font-heading text-sm font-bold group-hover:text-neon-cyan transition-colors uppercase tracking-tight truncate ${view === "list" ? "" : "text-base"}`}>{bot.name}</h3>
                <span className={`badge badge-${bot.tagColor} shrink-0`}>{bot.tag}</span>
              </div>
              <p className={`text-xs text-text-secondary font-medium leading-relaxed mb-3 ${view === "list" ? "truncate max-w-2xl" : "line-clamp-2"}`}>{bot.desc}</p>
              <div className="flex items-center justify-between pt-3 border-t border-white/5 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                <span className="flex items-center gap-3">
                  <span>BY_{bot.author.toUpperCase()}</span>
                  <span className="flex items-center gap-1"><StarRating rating={bot.rating} /> <span className="ml-0.5">{bot.rating}</span></span>
                </span>
                <span>{bot.uses} USES</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
