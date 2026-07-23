"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Gamepad2,
  Heart,
  Play,
  Grid3X3,
  List,
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
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
    return `/studio?prompt=${encodeURIComponent(prompt)}`;
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

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          {/* Top branding bar */}
          <div className="flex items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-purple-600 text-2xl shadow-lg shadow-orange-500/20">
                🎮
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                  Game Cloud
                </h1>
                <p className="text-xs sm:text-sm text-white/50 font-medium">
                  Free browser games, open-source classics, and bring-your-own-ROM emulators
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
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
          <div className="grid lg:grid-cols-[1fr_400px] gap-6 items-center">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] mb-3 text-orange-400">
                <Sparkles size={12} /> Featured Today
              </div>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] text-white mb-4">
                {featuredGame.title}
              </h2>
              <p className="text-base sm:text-lg text-white/60 max-w-xl mb-6 leading-relaxed">
                {featuredGame.description}
              </p>
              <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <Trophy size={15} className="text-yellow-400" />
                  <span className="font-bold">{featuredGame.rating}</span>
                  <span className="text-white/40">rating</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <Users size={15} className="text-cyan-400" />
                  <span className="font-bold">{featuredGame.players}P</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <Calendar size={15} className="text-purple-400" />
                  <span className="font-bold">{featuredGame.year}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck size={15} className="text-emerald-400" />
                  <span className="font-bold text-emerald-400">{featuredGame.licenseLabel}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => launchGame(featuredGame)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-black bg-white text-black hover:bg-white/90 transition-colors shadow-xl"
                >
                  <Play size={18} fill="currentColor" /> Play Now
                </button>
                <button
                  onClick={() => router.push(studioImageHref)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-bold border border-white/15 bg-white/5 backdrop-blur-sm text-white hover:bg-white/10 transition-colors"
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

          {/* Stats bar */}
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 pt-6 border-t border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-white">{GAME_LIBRARY.length}</span>
              <span className="text-xs text-white/40 font-bold uppercase tracking-wider">Instant Games</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-white">{EMULATOR_LABS.length}</span>
              <span className="text-xs text-white/40 font-bold uppercase tracking-wider">Emulator Labs</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-white">0</span>
              <span className="text-xs text-white/40 font-bold uppercase tracking-wider">Install Required</span>
            </div>
            <div className="h-6 w-px bg-white/10 hidden sm:block" />
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

      {/* ─── QUICK PLAY ─── */}
      {!selectedGame && (
        <section className="py-6 border-b border-white/5">
          <QuickPlayLibrary embedded />
        </section>
      )}

      {/* ─── EMULATOR LABS ─── */}
      {!selectedGame && (
        <section className="py-8 border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-orange-400">
                  <MonitorPlay size={14} /> Emulator Labs
                </div>
                <h2 className="text-2xl sm:text-3xl font-black mt-1.5 text-white">
                  Bring your own games
                </h2>
                <p className="text-sm text-white/50 mt-1.5 max-w-2xl">
                  The emulator is free; commercial game files usually are not. LiTT does not provide copyrighted ROMs.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 text-[11px] font-bold px-3 py-2 rounded-full border border-emerald-400/30 bg-emerald-400/5 text-emerald-400 self-start">
                <ShieldCheck size={14} /> Legal-use guardrails
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {EMULATOR_LABS.map((lab) => (
                <a
                  key={lab.name}
                  href={lab.href}
                  target={lab.href.startsWith("http") ? "_blank" : undefined}
                  rel={lab.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-6 transition-all hover:-translate-y-1 hover:border-white/20"
                >
                  <div
                    className="absolute -top-20 -right-20 h-40 w-40 rounded-full blur-3xl opacity-20 transition-opacity group-hover:opacity-40"
                    style={{ backgroundColor: lab.accent }}
                  />
                  <div className="relative flex items-start justify-between gap-4">
                    <div
                      className="grid h-14 w-14 place-items-center rounded-2xl text-2xl"
                      style={{ backgroundColor: `${lab.accent}15` }}
                    >
                      {lab.icon}
                    </div>
                    <ArrowUpRight
                      size={20}
                      className="text-white/30 group-hover:text-white group-hover:opacity-100 transition-all"
                    />
                  </div>
                  <div className="relative mt-5 text-[10px] font-black uppercase tracking-widest" style={{ color: lab.accent }}>
                    {lab.badge}
                  </div>
                  <h3 className="relative font-black text-xl mt-1 text-white">
                    {lab.name}
                  </h3>
                  <p className="relative text-sm text-white/55 mt-2 leading-relaxed">
                    {lab.description}
                  </p>
                  {lab.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lab.image}
                      alt={`${lab.name} systems`}
                      className="relative mt-4 h-10 w-auto rounded-md object-contain object-left opacity-80"
                    />
                  ) : (
                    <p className="relative text-[10px] font-bold text-white/35 mt-4 uppercase tracking-wider">
                      {lab.systems}
                    </p>
                  )}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── ARCADE RAIL ─── */}
      {!selectedGame && (
        <section className="py-8 border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="mb-5 flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-400">
                  Play Next
                </div>
                <h2 className="mt-1.5 text-2xl font-black text-white">
                  Scroll through the arcade
                </h2>
              </div>
              <span className="text-[10px] font-bold text-white/30 hidden sm:block">
                Swipe or use your trackpad →
              </span>
            </div>
            <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
              {GAME_LIBRARY.map((game) => (
                <button
                  key={`rail-${game.id}`}
                  type="button"
                  onClick={() => launchGame(game)}
                  className="group relative aspect-[4/3] w-[260px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 text-left sm:w-[320px] transition-all hover:border-white/25 hover:shadow-2xl"
                  aria-label={`Play ${game.title}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={game.coverUrl}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-[9px] font-black uppercase tracking-wider text-white/80">
                    {game.launchMode === "embedded" ? "▶ Play Here" : "↗ New Tab"}
                  </span>
                  <span className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
                    <span>
                      <span className="block text-base font-black text-white drop-shadow-lg">
                        {game.title}
                      </span>
                      <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-white/60">
                        {game.category} · {game.players}P · {game.year}
                      </span>
                    </span>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black shadow-xl transition group-hover:scale-110">
                      <Play size={16} fill="currentColor" />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── GAME PLAYER OVERLAY ─── */}
      {selectedGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-6xl mx-4">
            <div className="flex items-center justify-between p-4 rounded-t-2xl border-2 border-b-0 bg-[#0e0e16] border-white/10">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedGame(null)}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                >
                  ✕
                </button>
                <div>
                  <div className="font-black text-white">{selectedGame.title}</div>
                  <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    {selectedGame.platform.toUpperCase()} • {selectedGame.year}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleFav(selectedGame.id)}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 transition-colors hover:bg-white/10"
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
            <div className="p-4 rounded-b-2xl border-2 border-t-0 bg-[#0e0e16] border-white/10">
              <div className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-4 text-white/50 font-bold">
                  <span>👤 {selectedGame.players} Player{selectedGame.players > 1 ? "s" : ""}</span>
                  <span>🛡️ {selectedGame.licenseLabel}</span>
                  <span>🏢 {selectedGame.developer}</span>
                </div>
                <div className="flex gap-2">
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between py-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
            <input
              id="games-search"
              name="gamesSearch"
              type="text"
              placeholder="Search games or describe a scene to create..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-white outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/30"
            />
          </div>
          <button
            onClick={() => router.push(studioImageHref)}
            className="flex items-center gap-1.5 rounded-full border border-orange-500/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-400 transition hover:bg-orange-500/10"
            title="Generate a game-themed image"
          >
            <Shuffle size={11} /> Surprise Me
          </button>
          <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase border transition-all whitespace-nowrap rounded-lg ${
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
          <div className="flex items-center border border-white/10 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 transition-colors ${viewMode === "grid" ? "bg-white/10" : ""}`}
              style={{ color: viewMode === "grid" ? "#f97316" : "rgba(255,255,255,0.3)" }}
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 transition-colors ${viewMode === "list" ? "bg-white/10" : ""}`}
              style={{ color: viewMode === "list" ? "#f97316" : "rgba(255,255,255,0.3)" }}
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── GAMES GRID/LIST ─── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 py-6"
              : "space-y-2 py-6"
          }
        >
          {filteredGames.map((game) => (
            <div
              key={game.id}
              className={`group relative overflow-hidden rounded-2xl border transition-all hover:shadow-2xl ${
                viewMode === "grid" ? "" : "flex items-center gap-4 p-3"
              }`}
              style={{
                backgroundColor: "rgba(255,255,255,0.02)",
                borderColor: favorites.includes(game.id) ? "#f97316" : "rgba(255,255,255,0.08)",
              }}
            >
              {/* Cover */}
              <div
                className={`relative overflow-hidden cursor-pointer ${
                  viewMode === "grid" ? "aspect-[4/3]" : "w-24 h-24 shrink-0"
                }`}
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
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-white text-black shadow-2xl transition group-hover:scale-110">
                    <Play size={24} fill="currentColor" />
                  </div>
                </div>
                <div className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-[8px] font-black uppercase tracking-wider text-white/80">
                  {game.launchMode === "embedded" ? "▶ Play Here" : "↗ New Tab"}
                </div>
                {favorites.includes(game.id) && (
                  <div className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-orange-500/90 shadow-lg">
                    <Heart size={13} fill="white" className="text-white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className={viewMode === "grid" ? "p-4" : "flex-1 min-w-0"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-black text-sm truncate text-white">
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
                <div className="text-[11px] text-white/40 line-clamp-1 mt-0.5">
                  {game.description}
                </div>
                <div className="flex items-center gap-3 mt-2 text-[9px] text-white/30 font-bold">
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
                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-white/5">
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
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

        {/* Discovery Links */}
        <section className="grid sm:grid-cols-2 gap-3 pb-10">
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
        </section>
      </div>
    </div>
  );
}
