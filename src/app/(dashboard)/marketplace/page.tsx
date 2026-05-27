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

export default function MarketplacePage() {
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Bot Forge</h1>
          <p className="text-text-secondary text-sm">Discover, try, and deploy AI agents</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-cyber-surface border border-cyber-border rounded-lg overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={`px-3 py-1.5 text-xs ${view === "grid" ? "bg-neon-cyan text-cyber-bg" : "text-text-secondary"}`}
            >
              Grid
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-xs ${view === "list" ? "bg-neon-cyan text-cyber-bg" : "text-text-secondary"}`}
            >
              List
            </button>
          </div>
          <Link href="/builder" className="btn-primary text-sm">+ Create Bot</Link>
        </div>
      </div>

      <div className={`grid gap-4 ${view === "grid" ? "md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
        {BOTS.map(bot => (
          <Link
            key={bot.id}
            href={`/gallery/${bot.id}`}
            className={`card group cursor-pointer block ${view === "list" ? "flex items-center gap-4" : ""}`}
          >
            {view === "list" ? (
              <>
                <span className="text-3xl shrink-0">{bot.avatar}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold group-hover:text-neon-cyan transition-colors">{bot.name}</span>
                    <span className={`badge badge-${bot.tagColor}`}>{bot.tag}</span>
                  </div>
                  <p className="text-sm text-text-secondary truncate">{bot.desc}</p>
                </div>
                <div className="text-right shrink-0 text-xs text-text-muted">
                  <div>★ {bot.rating}</div>
                  <div>{bot.uses} uses</div>
                  <div>by {bot.author}</div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl">{bot.avatar}</span>
                  <span className={`badge badge-${bot.tagColor}`}>{bot.tag}</span>
                </div>
                <h3 className="font-heading text-base font-semibold mb-1 group-hover:text-neon-cyan transition-colors">{bot.name}</h3>
                <p className="text-text-secondary text-sm mb-3">{bot.desc}</p>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>by {bot.author}</span>
                  <span>★ {bot.rating} · {bot.uses} uses</span>
                </div>
              </>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
