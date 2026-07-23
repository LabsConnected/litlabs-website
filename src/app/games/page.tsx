"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Gamepad2,
  Heart,
  Play,
  Grid3X3,
  Zap,
  ExternalLink,
  Sparkles,
  Wand2,
  ShieldCheck,
  MonitorPlay,
  Code2,
  ArrowUpRight,
  Shuffle,
  Trophy,
  Users,
  Calendar,
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
import QuickPlayLibrary from "@/components/games/QuickPlayLibrary";

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

const GAME_PROMPTS = [
  "A neon-lit cyberpunk arcade at midnight, glowing cabinets, pixel art characters, rain on the window",
  "A cozy retro gaming room with CRT monitors, bean bags, snacks, and neon wall art",
  "A fantasy RPG battle scene in a glowing crystal cave, heroes versus a shadow dragon",
  "A side-scrolling platformer level made of candy, clouds, and floating coins",
  "A sci-fi racing game on a glowing track above a city skyline at sunset",
  "A puzzle game set inside a stained-glass cathedral with rotating gems",
  "A pixel-art space shooter dodging asteroids near a purple gas giant",
  "A whimsical farming sim with floating islands, crops, and friendly robots",
];

const EMULATOR_LABS = [
  {
    name: "LiTT Retro Arcade",
    description:
      "Your real, private ROM library with local storage, console detection, saves, controls, and a focused player.",
    systems: "NES · SNES · Genesis · GB · GBC · GBA",
    image: "/showcase/retro-arcade-thumb.svg",
    href: "/games/retro",
    badge: "Chapter 01",
    accent: "#f97316",
    icon: "🕹️",
  },
  {
    name: "DOS Lab",
    description:
      "Open DOS programs and shareware bundles you are licensed to use, with local saves and gamepad support.",
    systems: "DOS · Windows 9x",
    href: "/games/dos",
    badge: "js-dos",
    accent: "#22d3ee",
    icon: "💻",
  },
];

const FREE_DISCOVERY = [
  {
    label: "Open-source games",
    detail: "1,300+ browser games",
    href: "https://itch.io/games/free/html5/tag-open-source",
  },
  {
    label: "Homegames",
    detail: "Play, make, and share",
    href: "https://homegames.io/",
  },
];

function randomPrompt() {
  return GAME_PROMPTS[Math.floor(Math.random() * GAME_PROMPTS.length)];
}

export default function GamesPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<GameCategory | "all">(
    "all",
  );
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return getFavorites();
  });
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  const launchGame = useCallback((game: Game) => {
    if (!game.html5Url) return;
    if (game.launchMode === "new-tab") {
      window.open(game.html5Url, "_blank", "noopener,noreferrer");
      return;
    }
    setSelectedGame(game);
  }, []);

  const filteredGames = searchQuery
    ? searchGames(searchQuery)
    : activeCategory === "all"
      ? GAME_LIBRARY
      : getGamesByCategory(activeCategory);

  const studioImageHref = useMemo(() => {
    const prompt = searchQuery.trim() || randomPrompt();
    return `/studio?openImage=1&prompt=${encodeURIComponent(prompt)}`;
  }, [searchQuery]);

  const handleToggleFav = useCallback((gameId: string) => {
    const isNowFav = toggleFavorite(gameId);
    setFavorites((prev) =>
      isNowFav ? [...prev, gameId] : prev.filter((id) => id !== gameId),
    );
  }, []);

  const featuredGame = GAME_LIBRARY[3];

  return (
    <div className="min-h-dvh w-full text-white">
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-[#070812]" />
        <div className="absolute inset-0 opacity-60 bg-[radial-gradient(ellipse_at_20%_0%,rgba(249,115,22,0.25),transparent_50%),radial-gradient(ellipse_at_80%_100%,rgba(124,58,237,0.25),transparent_50%),radial-gradient(ellipse_at_50%_50%,rgba(34,211,238,0.12),transparent_60%)]" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
        {/* Scanlines */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.08]"
          style={{
            background:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.3), rgba(255,255,255,0.3) 1px, transparent 1px, transparent 3px)",
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-6 sm:pb-8">
          {/* Top branding bar */}
          <div className="flex items-center justify-between gap-3 mb-6 sm:mb-8">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="grid h-10 w-10 sm:h-12 sm:w-12 shrink-0 place-items-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-orange-500 to-purple-600 text-xl sm:text-2xl shadow-lg shadow-orange-500/20">
                🎮
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-3xl font-black tracking-tight text-white truncate">
                  Game Cloud
                </h1>
                <p className="text-[10px] sm:text-sm text-white/50 font-medium truncate">
                  Free browser games, open-source classics, and bring-your-own-ROM emulators
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button
                onClick={() => router.push(studioImageHref)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 transition-shadow"
              >
                <Wand2 size={14} /> Build in Studio
              </button>
              <a
                href="/studio"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-white/15 bg-white/5 backdrop-blur-sm text-white hover:bg-white/10 transition-colors"
              >
                <Sparkles size={14} /> Agent Pipelines
              </a>
            </div>
          </div>

          {/* Featured game showcase */}
          <div className="grid lg:grid-cols-[1fr_400px] gap-4 sm:gap-6 items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] sm:text-xs font-black uppercase tracking-[0.24em] mb-2 sm:mb-3 text-orange-400">
                <Sparkles size={12} /> Featured Today
              </div>
              <h2 className="text-2xl sm:text-5xl lg:text-6xl font-black leading-[1.05] text-white mb-3 sm:mb-4">
                {featuredGame.title}
              </h2>
              <p className="text-sm sm:text-lg text-white/60 max-w-xl mb-4 sm:mb-6 leading-relaxed">
                {featuredGame.description}
              </p>
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-white/70">
                  <Trophy size={13} className="text-yellow-400" />
                  <span className="font-bold">{featuredGame.rating}</span>
                  <span className="text-white/40 hidden sm:inline">rating</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-white/70">
                  <Users size={13} className="text-cyan-400" />
                  <span className="font-bold">{featuredGame.players}P</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-white/70">
                  <Calendar size={13} className="text-purple-400" />
                  <span className="font-bold">{featuredGame.year}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm">
                  <ShieldCheck size={13} className="text-emerald-400" />
                  <span className="font-bold text-emerald-400">{featuredGame.licenseLabel}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                <button
                  onClick={() => launchGame(featuredGame)}
                  className="inline-flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-black bg-white text-black hover:bg-white/90 transition-colors shadow-xl"
                >
                  <Play size={16} fill="currentColor" /> Play Now
                </button>
                <button
                  onClick={() => router.push(studioImageHref)}
                  className="inline-flex items-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-bold border border-white/15 bg-white/5 backdrop-blur-sm text-white hover:bg-white/10 transition-colors"
                >
                  <Shuffle size={16} /> Surprise Me
                </button>
              </div>
            </div>

            {/* Featured game cover */}
            <div className="relative hidden lg:block">
              <div className="absolute -inset-4 bg-gradient-to-br from-orange-500/20 to-purple-600/20 rounded-3xl blur-2xl" />
              <button
                onClick={() => launchGame(featuredGame)}
                className="group relative block w-full aspect-[4/3] rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={featuredGame.coverUrl}
                  alt={featuredGame.title}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                  <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-[10px] font-black uppercase tracking-wider text-white">
                    {featuredGame.launchMode === "embedded" ? "▶ Play Here" : "↗ Opens in Tab"}
                  </div>
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-black shadow-xl transition group-hover:scale-110">
                    <Play size={20} fill="currentColor" />
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Mobile featured cover */}
          <button
            onClick={() => launchGame(featuredGame)}
            className="group relative block w-full aspect-[16/9] rounded-xl overflow-hidden border border-white/10 shadow-xl mt-4 lg:hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={featuredGame.coverUrl}
              alt={featuredGame.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-[9px] font-black uppercase tracking-wider text-white">
                {featuredGame.launchMode === "embedded" ? "▶ Play Here" : "↗ Opens in Tab"}
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-black shadow-xl">
                <Play size={18} fill="currentColor" />
              </div>
            </div>
          </button>

          {/* Stats bar */}
          <div className="mt-6 sm:mt-8 flex flex-wrap items-center gap-x-4 sm:gap-x-8 gap-y-2 sm:gap-y-3 pt-4 sm:pt-6 border-t border-white/10">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-lg sm:text-2xl font-black text-white">{GAME_LIBRARY.length}</span>
              <span className="text-[10px] sm:text-xs text-white/40 font-bold uppercase tracking-wider">Instant Games</span>
            </div>
            <div className="h-5 sm:h-6 w-px bg-white/10" />
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-lg sm:text-2xl font-black text-white">{EMULATOR_LABS.length}</span>
              <span className="text-[10px] sm:text-xs text-white/40 font-bold uppercase tracking-wider">Emulator Labs</span>
            </div>
            <div className="h-5 sm:h-6 w-px bg-white/10" />
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-lg sm:text-2xl font-black text-white">0</span>
              <span className="text-[10px] sm:text-xs text-white/40 font-bold uppercase tracking-wider">Install Required</span>
            </div>
            <div className="h-5 sm:h-6 w-px bg-white/10 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/40">
              <span className="text-emerald-400">●</span> All Free · Open Source · No Ads
            </div>
          </div>
        </div>

        {/* Ticker */}
        <div className="relative z-10 w-full bg-black/60 backdrop-blur-sm py-1.5 border-y border-white/10 overflow-hidden flex">
          <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px] text-orange-400">
            <span>🎮 GAME CLOUD ONLINE // FREE TO PLAY</span>
            <span>⚡ OPEN SOURCE • HTML5 • EMULATOR READY</span>
            <span>🛡️ ONLY USE ROMS YOU OWN OR PUBLIC-DOMAIN HOMEBREW</span>
            <span>🎯 KEYBOARD • TOUCH • GAMEPAD</span>
          </div>
        </div>
      </section>

      {/* ─── GAME PLAYER OVERLAY ─── */}
      {selectedGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-2 sm:p-4">
          <div className="w-full max-w-6xl">
            <div className="flex items-center justify-between p-3 sm:p-4 rounded-t-2xl border-2 border-b-0 bg-[#0e0e16] border-white/10">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => setSelectedGame(null)}
                  className="grid h-9 w-9 sm:h-10 sm:w-10 shrink-0 place-items-center rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                >
                  ✕
                </button>
                <div className="min-w-0">
                  <div className="font-black text-white text-sm sm:text-base truncate">{selectedGame.title}</div>
                  <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    {selectedGame.platform.toUpperCase()} • {selectedGame.year}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggleFav(selectedGame.id)}
                  className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl border border-white/10 transition-colors hover:bg-white/10"
                  style={{ color: favorites.includes(selectedGame.id) ? "#f97316" : "rgba(255,255,255,0.4)" }}
                >
                  <Heart size={16} fill={favorites.includes(selectedGame.id) ? "#f97316" : "none"} />
                </button>
              </div>
            </div>
            <div className="aspect-video border-2 border-x relative overflow-hidden bg-black border-white/10">
              {selectedGame.html5Url ? (
                <div className="w-full h-full relative">
                  <iframe
                    title={`${selectedGame.title} game`}
                    src={selectedGame.html5Url}
                    className="w-full h-full"
                    allow="fullscreen; gamepad"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    referrerPolicy="no-referrer"
                    style={{ border: "none" }}
                  />
                  <a
                    href={selectedGame.html5Url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 bg-black/60 text-white backdrop-blur-sm opacity-0 hover:opacity-100 transition-opacity"
                  >
                    <ExternalLink size={10} /> Open in New Tab
                  </a>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl mb-4">🎮</div>
                    <p className="text-sm text-white/60 mb-4">No playable game available.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 sm:p-4 rounded-b-2xl border-2 border-t-0 bg-[#0e0e16] border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[10px]">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-white/50 font-bold">
                  <span>👤 {selectedGame.players} Player{selectedGame.players > 1 ? "s" : ""}</span>
                  <span>🛡️ {selectedGame.licenseLabel}</span>
                  <span className="hidden sm:inline">🏢 {selectedGame.developer}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {selectedGame.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded-md border border-white/10 text-white/50 font-bold uppercase">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="sticky top-0 z-20 bg-[#070812]/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          {/* Row 1: Search + view toggle */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
              <input
                id="games-search"
                name="gamesSearch"
                type="text"
                placeholder="Search games..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/30"
              />
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => router.push(studioImageHref)}
                className="flex items-center gap-1.5 rounded-full border border-orange-500/40 px-2.5 sm:px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-400 transition hover:bg-orange-500/10"
                title="Generate a game-themed image"
              >
                <Shuffle size={11} /> <span className="hidden sm:inline">Surprise Me</span>
              </button>
            </div>
          </div>
          {/* Row 2: Category chips (horizontal scroll on mobile) */}
          <div className="flex items-center gap-2 overflow-x-auto mt-2.5 sm:mt-3 pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase border transition-all whitespace-nowrap rounded-lg shrink-0 ${
                    isActive ? "opacity-100" : "opacity-50 hover:opacity-80"
                  }`}
                  style={{
                    borderColor: isActive ? "#f97316" : "rgba(255,255,255,0.1)",
                    backgroundColor: isActive ? "rgba(249,115,22,0.1)" : "transparent",
                    color: isActive ? "#f97316" : "#fff",
                  }}
                >
                  <Icon size={12} />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── GAME LIBRARY ─── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="space-y-3 py-4 sm:py-6">
          {filteredGames.map((game) => (
            <div
              key={game.id}
              className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border p-2.5 transition-all hover:border-white/20 hover:bg-white/[.035] hover:shadow-2xl sm:gap-4 sm:p-3"
              style={{
                backgroundColor: "rgba(255,255,255,0.02)",
                borderColor: favorites.includes(game.id) ? "#f97316" : "rgba(255,255,255,0.08)",
              }}
            >
              {/* Cover */}
              <div
                className="relative h-24 w-28 shrink-0 cursor-pointer overflow-hidden rounded-xl sm:h-32 sm:w-48"
                onClick={() => launchGame(game)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={game.coverUrl}
                  alt={game.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="%23070812"/><text x="200" y="150" text-anchor="middle" fill="%23333" font-size="60">🎮</text></svg>';
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px]">
                  <div className="grid h-10 w-10 sm:h-14 sm:w-14 place-items-center rounded-full bg-white text-black shadow-2xl transition group-hover:scale-110">
                    <Play size={18} fill="currentColor" />
                  </div>
                </div>
                <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-black/60 backdrop-blur-sm text-[7px] sm:text-[8px] font-black uppercase tracking-wider text-white/80">
                  {game.launchMode === "embedded" ? "▶" : "↗"}
                </div>
                {favorites.includes(game.id) && (
                  <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 grid h-6 w-6 sm:h-7 sm:w-7 place-items-center rounded-full bg-orange-500/90 shadow-lg">
                    <Heart size={11} fill="white" className="text-white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1 py-1 pr-1">
                <div className="flex items-start justify-between gap-1.5 sm:gap-2">
                  <div className="font-black text-xs sm:text-sm truncate text-white">
                    {game.title}
                  </div>
                  <button
                    onClick={() => handleToggleFav(game.id)}
                    className="shrink-0 opacity-30 group-hover:opacity-100 transition-opacity"
                    style={{ color: favorites.includes(game.id) ? "#f97316" : "rgba(255,255,255,0.4)" }}
                  >
                    <Heart size={14} fill={favorites.includes(game.id) ? "#f97316" : "none"} />
                  </button>
                </div>
                <div className="text-[10px] sm:text-[11px] text-white/40 line-clamp-1 mt-0.5">
                  {game.description}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[9px] font-bold text-white/30">
                  <span className="flex items-center gap-1">
                    <Users size={10} /> {game.players}P
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar size={10} /> {game.year}
                  </span>
                  <span className="flex items-center gap-1">
                    <Trophy size={10} /> {game.rating}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-white/5">
                  <span className="inline-flex items-center gap-1 text-[8px] sm:text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                    <ShieldCheck size={11} /> {game.licenseLabel}
                  </span>
                  {game.sourceUrl && (
                    <a
                      href={game.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`View ${game.title} source`}
                      className="text-white/30 hover:text-white transition-colors"
                    >
                      <Code2 size={13} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredGames.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 opacity-30">🔍</div>
            <p className="text-white/40 font-bold">No games found matching your search.</p>
            <button
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("all");
              }}
              className="mt-4 px-5 py-2.5 rounded-xl border border-white/10 text-sm font-bold text-white hover:bg-white/5 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        )}

      </div>

      {/* ─── RETRO ARCADE SECTION ─── */}
      {!selectedGame && (
        <section className="py-6 sm:py-10 border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {/* Section header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-5 sm:mb-6">
              <div>
                <div className="flex items-center gap-2 text-[10px] sm:text-xs font-black uppercase tracking-[0.22em] text-orange-400">
                  <MonitorPlay size={14} /> Retro Arcade
                </div>
                <h2 className="text-xl sm:text-3xl font-black mt-1.5 text-white">
                  Bring your own games
                </h2>
                <p className="text-xs sm:text-sm text-white/50 mt-1.5 max-w-2xl">
                  The emulator is free; commercial game files usually are not. LiTT does not provide copyrighted ROMs.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 text-[11px] font-bold px-3 py-2 rounded-full border border-emerald-400/30 bg-emerald-400/5 text-emerald-400 self-start">
                <ShieldCheck size={14} /> Legal-use guardrails
              </div>
            </div>

            {/* Emulator Lab cards */}
            <div className="mb-6 space-y-3 sm:mb-8">
              {EMULATOR_LABS.map((lab) => (
                <a
                  key={lab.name}
                  href={lab.href}
                  target={lab.href.startsWith("http") ? "_blank" : undefined}
                  rel={lab.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-white/[0.04] to-transparent p-4 transition-all hover:border-white/20 sm:p-5"
                >
                  <div
                    className="absolute -top-20 -right-20 h-40 w-40 rounded-full blur-3xl opacity-20 transition-opacity group-hover:opacity-40"
                    style={{ backgroundColor: lab.accent }}
                  />
                  <div className="relative shrink-0">
                    <div
                      className="grid h-14 w-14 place-items-center rounded-2xl text-2xl"
                      style={{ backgroundColor: `${lab.accent}15` }}
                    >
                      {lab.icon}
                    </div>
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: lab.accent }}>
                      {lab.badge}
                    </div>
                    <h3 className="mt-1 font-black text-white sm:text-lg">{lab.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/55 sm:text-sm">{lab.description}</p>
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-white/35">{lab.systems}</p>
                  </div>
                  <ArrowUpRight size={18} className="relative shrink-0 text-white/30 transition-colors group-hover:text-white" />
                </a>
              ))}
            </div>

            {/* Quick Play homebrew ROMs */}
            <div className="mb-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-400 mb-2">
                <Sparkles size={12} /> Free Homebrew ROMs
              </div>
              <p className="text-sm text-white/50 max-w-2xl">
                Public-domain and MIT-licensed homebrew games you can launch with one click. No copyright issues.
              </p>
            </div>
            <QuickPlayLibrary embedded />
          </div>
        </section>
      )}

      {/* ─── DISCOVERY LINKS ─── */}
      {!selectedGame && (
        <section className="py-4 sm:py-6 border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="space-y-2.5 pb-6 sm:pb-10">
              {FREE_DISCOVERY.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] p-5 hover:border-white/15 hover:bg-white/[0.02] transition-all"
                >
                  <div>
                    <div className="text-sm font-black text-white">{item.label}</div>
                    <div className="text-xs text-white/40 mt-0.5">{item.detail}</div>
                  </div>
                  <ExternalLink size={16} className="text-white/20 group-hover:text-white/60 transition-colors" />
                </a>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
