"use client";

import { useState, useMemo } from "react";
import { GAME_LIBRARY, type Game } from "@/lib/games";
import MobileGameNav from "./MobileGameNav";
import { X, ExternalLink, Search, Star, Gamepad2, Zap, Trophy, Users, ChevronRight, Play } from "lucide-react";

const GAME_EMOJIS: Record<string, string> = {
  "pong": "🏓", "2048": "🔢", "hextris": "🔷", "tetris": "🟦", "pac-man": "🕹",
  "snake": "🐍", "minesweeper": "💣", "chess": "♟", "doom": "🔥", "asteroids": "🚀",
  "breakout": "🧱", "space-invaders": "👾", "connect-4": "🔴", "frogger": "🐸",
  "chrome-dino": "🦖", "wordle": "📝", "geometry-dash": "⚡", "cut-the-rope": "🍬",
  "sudoku": "🔢", "1010": "🟩", "type-racer": "⌨️", "type-fast": "⌨️",
};

const CATEGORY_GRADIENTS: Record<string, string> = {
  arcade: "linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 50%, #0d0d1e 100%)",
  puzzle: "linear-gradient(135deg, #0d1a2e 0%, #1b3a5e 50%, #0d0d1e 100%)",
  retro: "linear-gradient(135deg, #2e1a0a 0%, #5e3b1b 50%, #1e0d0d 100%)",
  action: "linear-gradient(135deg, #2e0a0a 0%, #5e1b1b 50%, #1e0d0d 100%)",
  classic: "linear-gradient(135deg, #0a2e1a 0%, #1b5e3b 50%, #0d1e0d 100%)",
  multiplayer: "linear-gradient(135deg, #1a0a2e 0%, #4e1b5e 50%, #0d0d1e 100%)",
};

function GameCover({ game, size }: { game: Game; size: "hero" | "tile" | "thumb" }) {
  const emoji = GAME_EMOJIS[game.id] ?? "🎮";
  const gradient = CATEGORY_GRADIENTS[game.category] ?? "linear-gradient(135deg, #1a0a2e, #0d0d1e)";
  const fontSize = size === "hero" ? "5rem" : size === "tile" ? "2.5rem" : "1.2rem";
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: gradient }}>
      <span style={{ fontSize, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.4))" }}>{emoji}</span>
    </div>
  );
}

const CATEGORIES = [
  { key: "all", label: "🎮 All" },
  { key: "featured", label: "⚡ Featured" },
  { key: "arcade", label: "🕹 Arcade" },
  { key: "puzzle", label: "🧩 Puzzle" },
  { key: "retro", label: "👾 Retro" },
  { key: "action", label: "🔥 Action" },
  { key: "multiplayer", label: "👥 Multiplayer" },
  { key: "classic", label: "♟ Classic" },
];

const HERO_GAME = GAME_LIBRARY.find((g) => g.id === "geometry-dash") ?? GAME_LIBRARY[0];
const SPOTLIGHT = GAME_LIBRARY.filter((g) => g.featured).slice(0, 5);

export default function GameCloudHome() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("retro");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [heroIdx, setHeroIdx] = useState(0);
  const heroGame = SPOTLIGHT[heroIdx] ?? HERO_GAME;

  const filteredGames = useMemo(() => {
    let list = GAME_LIBRARY;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.tags.some((t) => t.includes(q)) ||
          g.category.includes(q),
      );
    } else if (activeCategory === "featured") {
      list = list.filter((g) => g.featured);
    } else if (activeCategory === "retro") {
      // Retro Arcade shows the full library since every game is a browser classic
      list = GAME_LIBRARY;
    } else if (activeCategory !== "all") {
      list = list.filter((g) => g.category === activeCategory || g.tags.includes(activeCategory));
    }
    return list;
  }, [searchQuery, activeCategory]);

  const topPicks = GAME_LIBRARY.filter((g) => g.featured).slice(0, 6);
  const recentlyAdded = GAME_LIBRARY.slice(-8);

  return (
    <main className="min-h-screen bg-[#06060f] text-white pb-28">

      {/* ── HERO BANNER ── */}
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #0d0d1e 0%, #1a0a2e 50%, #0d1a0d 100%)" }}>
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: "radial-gradient(circle at 20% 50%, #ff6b00 0%, transparent 40%), radial-gradient(circle at 80% 50%, #7c3aed 0%, transparent 40%)",
        }} />
        <div className="relative max-w-7xl mx-auto px-4 py-8 md:py-14 flex flex-col md:flex-row items-center gap-8">
          {/* Left: text */}
          <div className="flex-1 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest" style={{ backgroundColor: "#ff6b0020", border: "1px solid #ff6b0040", color: "#ff6b00" }}>
              <Zap size={10} className="fill-current" /> Retro Arcade
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-none text-white">
              Play.<br /><span style={{ color: "#ff6b00" }}>Instantly.</span>
            </h1>
            <p className="text-slate-400 text-sm md:text-base max-w-md">
              25+ free HTML5 games — arcade, puzzle, retro, action, and multiplayer. No downloads, no accounts.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedGame(heroGame)}
                className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-black transition hover:scale-105"
                style={{ backgroundColor: "#ff6b00", color: "#000" }}
              >
                <Play size={16} className="fill-current" /> Play Now
              </button>
              <button
                onClick={() => setActiveCategory("featured")}
                className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold border transition hover:border-orange-500/60"
                style={{ borderColor: "#ffffff20", color: "#ccc" }}
              >
                Browse All <ChevronRight size={14} />
              </button>
            </div>
            {/* Spotlight dots */}
            <div className="flex items-center gap-2 pt-2">
              {SPOTLIGHT.map((g, i) => (
                <button
                  key={g.id}
                  onClick={() => setHeroIdx(i)}
                  className="text-[10px] font-bold px-2 py-1 rounded-full transition-all"
                  style={{
                    backgroundColor: i === heroIdx ? "#ff6b00" : "#ffffff15",
                    color: i === heroIdx ? "#000" : "#888",
                  }}
                >
                  {g.title.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Right: hero game art */}
          <div className="relative shrink-0 w-full md:w-[380px] h-[220px] md:h-[280px] rounded-2xl overflow-hidden border border-white/10" style={{ boxShadow: "0 0 60px rgba(255,107,0,0.2)", background: "linear-gradient(135deg, #1a0a2e 0%, #0d1a0d 100%)" }}>
            <GameCover game={heroGame} size="hero" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%)" }} />
            <div className="absolute bottom-4 left-4 right-4">
              <div className="text-xs font-black uppercase tracking-widest text-orange-400 mb-1">{heroGame.category}</div>
              <div className="text-lg font-black">{heroGame.title}</div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                <span>⭐ {heroGame.rating}</span>
                <span>👁 {heroGame.plays}</span>
                <span className="capitalize">{heroGame.difficulty}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS BAR ── */}
      <div className="border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-4 py-3 grid grid-cols-4 divide-x divide-white/5">
          {[
            { icon: Gamepad2, label: "Games", value: GAME_LIBRARY.length + "+" },
            { icon: Zap, label: "Instant Play", value: "HTML5" },
            { icon: Trophy, label: "Free Forever", value: "100%" },
            { icon: Users, label: "Multiplayer", value: "5 Games" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex flex-col items-center py-1 gap-0.5">
              <Icon size={14} style={{ color: "#ff6b00" }} />
              <span className="text-xs font-black text-white">{value}</span>
              <span className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-6 space-y-8">

        {/* ── SEARCH ── */}
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search 25+ games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl pl-11 pr-4 py-3.5 text-sm outline-none text-white placeholder:text-slate-600 transition-colors"
            style={{ backgroundColor: "#0f0f1e", border: "1px solid #ffffff15" }}
          />
        </div>

        {/* ── CATEGORY TABS ── */}
        {!searchQuery && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className="shrink-0 rounded-xl px-4 py-2 text-xs font-black transition-all"
                style={{
                  backgroundColor: activeCategory === cat.key ? "#ff6b00" : "#ffffff0a",
                  color: activeCategory === cat.key ? "#000" : "#888",
                  border: `1px solid ${activeCategory === cat.key ? "#ff6b00" : "#ffffff15"}`,
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* ── SEARCH RESULTS ── */}
        {searchQuery && (
          <GameGrid
            title={`Results for "${searchQuery}"`}
            games={filteredGames}
            onPlay={setSelectedGame}
          />
        )}

        {/* ── FILTERED CATEGORY ── */}
        {!searchQuery && activeCategory !== "all" && (
          <GameGrid
            title={CATEGORIES.find((c) => c.key === activeCategory)?.label ?? "Games"}
            games={filteredGames}
            onPlay={setSelectedGame}
          />
        )}

        {/* ── ALL SECTIONS ── */}
        {!searchQuery && activeCategory === "all" && (
          <>
            <GameGrid
              title="⚡ Top Picks"
              subtitle="Most played this week"
              games={topPicks}
              onPlay={setSelectedGame}
            />

            <GameGrid
              title="🕹 Arcade & Action"
              games={GAME_LIBRARY.filter((g) => ["arcade", "action"].includes(g.category))}
              onPlay={setSelectedGame}
              max={6}
            />

            <GameGrid
              title="🧩 Puzzle & Brain"
              games={GAME_LIBRARY.filter((g) => g.category === "puzzle")}
              onPlay={setSelectedGame}
              max={6}
            />

            <GameGrid
              title="👾 Retro Classics"
              games={GAME_LIBRARY.filter((g) => g.category === "retro" || g.tags.includes("classic"))}
              onPlay={setSelectedGame}
              max={6}
            />

            <GameGrid
              title="👥 Multiplayer"
              games={GAME_LIBRARY.filter((g) => g.players > 1 || g.category === "multiplayer")}
              onPlay={setSelectedGame}
              max={4}
            />

            <GameGrid
              title="🆕 Recently Added"
              games={recentlyAdded}
              onPlay={setSelectedGame}
            />
          </>
        )}
      </div>

      <MobileGameNav />

      {/* ── GAME PLAYER MODAL ── */}
      {selectedGame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
          onClick={(e) => e.target === e.currentTarget && setSelectedGame(null)}
        >
          <div className="w-full max-w-5xl rounded-2xl overflow-hidden flex flex-col" style={{ backgroundColor: "#0a0a18", border: "1px solid #ffffff15", maxHeight: "95vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0" style={{ background: "linear-gradient(135deg, #1a0a2e, #0d1a0d)" }}>
                  <GameCover game={selectedGame} size="thumb" />
                </div>
                <div>
                  <h2 className="font-black text-sm text-white">{selectedGame.title}</h2>
                  <p className="text-[10px] text-slate-500">{selectedGame.year} · {selectedGame.developer} · {selectedGame.players}P</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs font-bold text-yellow-400">
                  <Star size={12} className="fill-current" /> {selectedGame.rating}
                </span>
                <a
                  href={selectedGame.html5Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg border border-white/10 text-slate-400 hover:text-white transition"
                  title="Full screen"
                >
                  <ExternalLink size={15} />
                </a>
                <button
                  onClick={() => setSelectedGame(null)}
                  className="p-2 rounded-lg border border-white/10 text-slate-400 hover:text-white transition"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* iframe */}
            <div className="relative bg-black flex-1" style={{ minHeight: "300px" }}>
              <iframe
                src={selectedGame.html5Url}
                className="w-full h-full absolute inset-0"
                style={{ border: "none", minHeight: "340px" }}
                allow="fullscreen; gamepad; autoplay"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {selectedGame.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded text-[9px] border border-white/10 text-slate-500 uppercase font-bold">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                <span>👁 {selectedGame.plays}</span>
                <span className="capitalize border border-white/10 px-2 py-0.5 rounded text-[9px] font-bold">{selectedGame.difficulty}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function GameGrid({
  title,
  subtitle,
  games,
  onPlay,
  max,
}: {
  title: string;
  subtitle?: string;
  games: Game[];
  onPlay: (g: Game) => void;
  max?: number;
}) {
  const list = max ? games.slice(0, max) : games;
  if (!list.length) return null;
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-black text-white">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-xs text-orange-400 font-bold">{list.length} games</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {list.map((game) => (
          <GameTile key={game.id} game={game} onPlay={onPlay} />
        ))}
      </div>
    </section>
  );
}

function GameTile({ game, onPlay }: { game: Game; onPlay: (g: Game) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
      style={{
        border: "1px solid #ffffff10",
        transform: hovered ? "translateY(-3px)" : "none",
        boxShadow: hovered ? "0 12px 32px rgba(0,0,0,0.6)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onPlay(game)}
    >
      {/* Cover art */}
      <div className="relative aspect-4/3 bg-[#0f0f1e]" style={{ background: "linear-gradient(135deg, #1a0a2e 0%, #0d0d1e 100%)" }}>
        <GameCover game={game} size="tile" />
        {/* Play overlay */}
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
          style={{ backgroundColor: "rgba(0,0,0,0.55)", opacity: hovered ? 1 : 0 }}
        >
          <div className="rounded-full p-3 text-black font-black" style={{ backgroundColor: "#ff6b00" }}>
            <Play size={18} className="fill-current" />
          </div>
        </div>
        {/* Featured badge */}
        {game.featured && (
          <div className="absolute top-2 left-2 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase" style={{ backgroundColor: "#ff6b00", color: "#000" }}>
            ⚡ Hot
          </div>
        )}
        {/* Rating */}
        <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ backgroundColor: "rgba(0,0,0,0.75)", color: "#fbbf24" }}>
          <Star size={8} className="fill-current" /> {game.rating}
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5" style={{ backgroundColor: "#0c0c1a" }}>
        <div className="font-black text-[11px] text-white truncate">{game.title}</div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#ff6b0099" }}>{game.category}</span>
          <span className="text-[9px] text-slate-600">{game.plays}</span>
        </div>
      </div>
    </div>
  );
}
