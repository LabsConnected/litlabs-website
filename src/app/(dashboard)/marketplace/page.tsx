"use client";

const BOTS = [
  { id: 1, name: "Code Assistant", desc: "AI pair programmer for any language", author: "LitLabs", rating: 4.9, uses: "1.2k", tag: "DEV", color: "cyan" },
  { id: 2, name: "Social Manager", desc: "Auto-post, engage, and grow your audience", author: "LitLabs", rating: 4.7, uses: "856", tag: "SOCIAL", color: "purple" },
  { id: 3, name: "Data Analyzer", desc: "Upload data, get insights instantly", author: "Community", rating: 4.5, uses: "634", tag: "DATA", color: "gold" },
  { id: 4, name: "Trading Bot", desc: "Automated trading strategies and alerts", author: "Community", rating: 4.3, uses: "412", tag: "TRADING", color: "green" },
  { id: 5, name: "Writing Coach", desc: "Improve your writing with AI feedback", author: "LitLabs", rating: 4.8, uses: "978", tag: "WRITING", color: "cyan" },
  { id: 6, name: "Support Agent", desc: "24/7 customer support automation", author: "Community", rating: 4.6, uses: "543", tag: "SUPPORT", color: "purple" },
];

export default function MarketplacePage() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Bot Forge</h1>
          <p className="text-text-secondary text-sm">Discover and deploy AI agents</p>
        </div>
        <button className="btn-primary text-sm">+ Create Bot</button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {BOTS.map(bot => (
          <div key={bot.id} className="card group cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <span className={`badge badge-${bot.color}`}>{bot.tag}</span>
              <span className="text-xs text-text-muted">★ {bot.rating}</span>
            </div>
            <h3 className="font-heading text-base font-semibold mb-1 group-hover:text-neon-cyan transition-colors">{bot.name}</h3>
            <p className="text-text-secondary text-sm mb-3">{bot.desc}</p>
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>by {bot.author}</span>
              <span>{bot.uses} uses</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
