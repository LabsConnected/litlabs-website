"use client";

import { useState, useCallback, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import GameEmulator from "@/components/GameEmulator";
import {
  Search,
  Gamepad2,
  Heart,
  Play,
  Grid3X3,
  List,
  Zap,
  ExternalLink,
} from "lucide-react";
import {
  GAME_LIBRARY,
  getFavorites,
  toggleFavorite,
  searchGames,
  getGamesByCategory,
  type Game,
  type GameCategory,
} from "@/lib/games";

const CATEGORIES: {
  id: GameCategory | "all";
  label: string;
  icon: typeof Gamepad2;
}[] = [
  { id: "all", label: "All Games", icon: Grid3X3 },
  { id: "retro", label: "Retro", icon: Gamepad2 },
  { id: "arcade", label: "Arcade", icon: Zap },
  { id: "puzzle", label: "Puzzle", icon: Grid3X3 },
];

export default function GamesPage() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<GameCategory | "all">(
    "all",
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return getFavorites();
  });
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  // Filter games
  const filteredGames = searchQuery
    ? searchGames(searchQuery)
    : activeCategory === "all"
      ? GAME_LIBRARY
      : getGamesByCategory(activeCategory);

  const handleToggleFav = useCallback((gameId: string) => {
    const isNowFav = toggleFavorite(gameId);
    setFavorites((prev) =>
      isNowFav ? [...prev, gameId] : prev.filter((id) => id !== gameId),
    );
  }, []);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/games");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T?.bgColor }}
      >
        <div className="text-center">
          <div className="text-2xl mb-2 animate-pulse">🎮</div>
          <div>Loading Game Cloud...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Sign In">
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <p className="text-sm opacity-60">Please sign in to play games.</p>
          <Link
            href="/sign-in?redirect_url=/games"
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Sign In
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Game Cloud"
      subtitle="Play HTML5 arcade and puzzle classics right in your browser"
      icon="🎮"
    >
      {/* Retro Ticker */}
      <div
        className="w-full bg-black py-1 border-b-2 overflow-hidden flex"
        style={{ borderColor: T.borderColor, color: T.accentColor }}
      >
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>🎮 GAME CLOUD ONLINE // HTML5 ARCADE READY</span>
          <span>⚡ PUZZLE • ARCADE • CLASSICS • NO INSTALLS</span>
          <span>🏆 LEADERBOARDS ACTIVE // MULTIPLAYER ENABLED</span>
          <span>💾 CLOUD SAVES SYNCED ACROSS DEVICES</span>
        </div>
      </div>

      {/* Featured Game Hero */}
      {!selectedGame && (
        <div
          className="relative h-[300px] md:h-[400px] overflow-hidden border-b-2"
          style={{ borderColor: T.borderColor }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${T.accentColor}20, ${T.linkColor}20)`,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl md:text-8xl mb-4">🎮</div>
              <h1
                className="text-2xl md:text-4xl font-black mb-2"
                style={{ color: T.headerColor }}
              >
                LiTTree Game Cloud
              </h1>
              <p className="text-sm opacity-60" style={{ color: T.textMuted }}>
                {GAME_LIBRARY.length} games available • Puzzle • Arcade •
                HTML5
              </p>
            </div>
          </div>
          {/* Scanlines */}
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              background:
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.2), rgba(0,0,0,0.2) 1px, transparent 1px, transparent 2px)",
            }}
          />
        </div>
      )}

      {/* Game Player Overlay */}
      {selectedGame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: T.bgColor + "f0" }}
        >
          <div className="w-full max-w-6xl mx-4">
            {/* Player Header */}
            <div
              className="flex items-center justify-between p-4 border-2 mb-2"
              style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedGame(null)}
                  className="p-2 border hover:opacity-80"
                  style={{ borderColor: T.borderColor }}
                >
                  ✕
                </button>
                <div>
                  <div className="font-bold" style={{ color: T.headerColor }}>
                    {selectedGame.title}
                  </div>
                  <div className="text-[10px] opacity-60">
                    {selectedGame.platform.toUpperCase()} • {selectedGame.year}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleFav(selectedGame.id)}
                  className="p-2 border hover:opacity-80"
                  style={{
                    borderColor: T.borderColor,
                    color: favorites.includes(selectedGame.id)
                      ? T.accentColor
                      : T.textMuted,
                  }}
                >
                  <Heart
                    size={16}
                    fill={
                      favorites.includes(selectedGame.id)
                        ? T.accentColor
                        : "none"
                    }
                  />
                </button>
              </div>
            </div>

            {/* Game Canvas / Iframe / Emulator */}
            <div
              className="aspect-video border-2 relative overflow-hidden"
              style={{ backgroundColor: "#000", borderColor: T.borderColor }}
            >
              {selectedGame.html5Url ? (
                <div className="w-full h-full relative">
                  <iframe
                    src={selectedGame.html5Url}
                    className="w-full h-full"
                    allow="fullscreen; gamepad"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    referrerPolicy="no-referrer"
                    style={{ border: "none" }}
                  />
                  {/* Overlay for external link */}
                  <a
                    href={selectedGame.html5Url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity"
                    style={{
                      backgroundColor: T.bgColor + "cc",
                      color: T.textColor,
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    <ExternalLink size={10} />
                    Open in New Tab
                  </a>
                </div>
              ) : selectedGame.romUrl && selectedGame.platform !== "html5" ? (
                <GameEmulator
                  romUrl={selectedGame.romUrl}
                  platform={selectedGame.platform}
                  onError={(err) => console.error("Emulator error:", err)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl mb-4">🎮</div>
                    <p className="text-sm opacity-60 mb-4">
                      No game file available
                    </p>
                    <p className="text-[10px] opacity-40 max-w-md">
                      This game requires a ROM file that hasn&apos;t been added
                      yet.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Game Info Bar */}
            <div
              className="p-3 border-2 border-t-0"
              style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
            >
              <div className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-4">
                  <span style={{ color: T.textMuted }}>
                    👤 {selectedGame.players} Player
                    {selectedGame.players > 1 ? "s" : ""}
                  </span>
                  <span style={{ color: T.textMuted }}>
                    ⭐ {selectedGame.rating}/5.0
                  </span>
                  <span style={{ color: T.textMuted }}>
                    🏢 {selectedGame.developer}
                  </span>
                </div>
                <div className="flex gap-2">
                  {selectedGame.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 border"
                      style={{ borderColor: T.borderColor, color: T.textMuted }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div
        className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between py-4 border-b"
        style={{ borderColor: T.borderColor }}
      >
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2"
            size={16}
            style={{ color: T.textMuted }}
          />
          <input
            type="text"
            placeholder="Search games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border bg-transparent text-sm outline-none focus:border-cyan-500/50"
            style={{ borderColor: T.borderColor, color: T.textColor }}
          />
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase border transition-all whitespace-nowrap ${
                  isActive ? "opacity-100" : "opacity-60 hover:opacity-80"
                }`}
                style={{
                  borderColor: isActive ? T.accentColor : T.borderColor,
                  backgroundColor: isActive
                    ? T.accentColor + "10"
                    : "transparent",
                  color: isActive ? T.accentColor : T.textColor,
                }}
              >
                <Icon size={12} />
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* View Toggle */}
        <div
          className="flex items-center border"
          style={{ borderColor: T.borderColor }}
        >
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 ${viewMode === "grid" ? "opacity-100" : "opacity-40"}`}
            style={{ color: viewMode === "grid" ? T.accentColor : T.textMuted }}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 ${viewMode === "list" ? "opacity-100" : "opacity-40"}`}
            style={{ color: viewMode === "list" ? T.accentColor : T.textMuted }}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Games Grid/List */}
      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 py-6"
            : "space-y-2 py-6"
        }
      >
        {filteredGames.map((game) => (
          <div
            key={game.id}
            className={`group relative border-2 overflow-hidden transition-all hover:scale-[1.02] ${
              viewMode === "grid" ? "" : "flex items-center gap-4 p-3"
            }`}
            style={{
              backgroundColor: T.boxBg,
              borderColor: favorites.includes(game.id)
                ? T.accentColor
                : T.borderColor,
            }}
          >
            {/* Cover */}
            <div
              className={`relative overflow-hidden cursor-pointer ${
                viewMode === "grid" ? "aspect-square" : "w-20 h-20 shrink-0"
              }`}
              onClick={() => setSelectedGame(game)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={game.coverUrl}
                alt={game.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/><text x="50" y="50" text-anchor="middle" fill="%23666" font-size="40">🎮</text></svg>';
                }}
              />
              {/* Play overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
                <Play
                  size={viewMode === "grid" ? 48 : 24}
                  style={{ color: T.accentColor }}
                />
              </div>
              {/* Platform badge */}
              <div className="absolute top-1 left-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-black/70 text-white">
                {game.platform}
              </div>
            </div>

            {/* Info */}
            <div className={viewMode === "grid" ? "p-3" : "flex-1 min-w-0"}>
              <div className="flex items-start justify-between gap-2">
                <div
                  className="font-bold text-sm truncate"
                  style={{ color: T.headerColor }}
                >
                  {game.title}
                </div>
                <button
                  onClick={() => handleToggleFav(game.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    color: favorites.includes(game.id)
                      ? T.accentColor
                      : T.textMuted,
                  }}
                >
                  <Heart
                    size={14}
                    fill={favorites.includes(game.id) ? T.accentColor : "none"}
                  />
                </button>
              </div>
              <div
                className="text-[10px] opacity-60 line-clamp-1"
                style={{ color: T.textMuted }}
              >
                {game.description}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[9px] opacity-40">
                <span>⭐ {game.rating}</span>
                <span>👤 {game.players}P</span>
                <span>{game.year}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredGames.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">🔍</div>
          <p className="opacity-60">No games found matching your search.</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setActiveCategory("all");
            }}
            className="mt-4 px-4 py-2 border text-sm hover:opacity-80"
            style={{ borderColor: T.borderColor }}
          >
            Clear Filters
          </button>
        </div>
      )}
    </PageShell>
  );
}
