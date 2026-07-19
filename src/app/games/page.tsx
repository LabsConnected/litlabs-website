"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import PageShell from "@/components/PageShell";
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
  Upload,
  MonitorPlay,
  Code2,
  ArrowUpRight,
  Shuffle,
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
  },
  {
    name: "DOS Lab",
    description:
      "Open DOS programs and shareware bundles you are licensed to use, with local saves and gamepad support.",
    systems: "DOS · Windows 9x",
    href: "https://js-dos.com/",
    badge: "js-dos",
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
  const { resolvedColors: T } = useTheme();
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

  // Filter games
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

  return (
    <PageShell
      title="Game Cloud"
      subtitle="Free browser games, open-source classics, and bring-your-own-ROM emulators"
      icon="🎮"
    >
      <div className="px-4 sm:px-6 pt-4">
        <div
          className="rounded-3xl border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(59,130,246,0.08))",
            borderColor: `${T.borderColor}30`,
          }}
        >
          <div>
            <div
              className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] mb-1"
              style={{ color: T.accentColor }}
            >
              <Sparkles size={12} /> Best build path
            </div>
            <p className="text-sm opacity-75 max-w-2xl">
              Play instantly, discover creator-friendly games, or bring files
              you already have the right to use. Build original mini-games in
              Studio when you want something uniquely yours.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => router.push(studioImageHref)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <Wand2 size={14} /> Build in Studio
            </button>
            <a
              href="/studio"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border"
              style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
            >
              Agent Pipelines
            </a>
          </div>
        </div>
      </div>

      {/* Games Ticker */}
      <div
        className="w-full bg-black py-1 border-b-2 overflow-hidden flex mt-4"
        style={{ borderColor: T.borderColor, color: T.accentColor }}
      >
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>🎮 GAME CLOUD ONLINE // FREE TO PLAY</span>
          <span>⚡ OPEN SOURCE • HTML5 • EMULATOR READY</span>
          <span>🛡️ ONLY USE ROMS YOU OWN OR PUBLIC-DOMAIN HOMEBREW</span>
          <span>🎯 KEYBOARD • TOUCH • GAMEPAD</span>
        </div>
      </div>

      {/* Featured Game Hero */}
      {!selectedGame && (
        <div
          className="relative h-[40vh] min-h-[280px] md:h-[50vh] md:min-h-[360px] overflow-hidden border-b-2"
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
                LiTT Code Game Cloud
              </h1>
              <p className="text-sm opacity-60" style={{ color: T.textMuted }}>
                {GAME_LIBRARY.length} instant games • {EMULATOR_LABS.length}{" "}
                emulator labs • no install
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

      {!selectedGame && (
        <section
          className="py-6 border-b"
          style={{ borderColor: `${T.borderColor}50` }}
        >
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
            <div>
              <div
                className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em]"
                style={{ color: T.accentColor }}
              >
                <MonitorPlay size={14} /> Emulator labs
              </div>
              <h2
                className="text-xl sm:text-2xl font-black mt-1"
                style={{ color: T.headerColor }}
              >
                Bring your own games
              </h2>
              <p className="text-sm opacity-60 mt-1 max-w-2xl">
                The emulator is free; commercial game files usually are not.
                LiTT does not provide copyrighted ROMs.
              </p>
            </div>
            <div
              className="inline-flex items-center gap-2 text-[11px] font-bold px-3 py-2 rounded-full border self-start"
              style={{
                borderColor: `${T.accentColor}60`,
                color: T.accentColor,
              }}
            >
              <ShieldCheck size={14} /> Legal-use guardrails
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {EMULATOR_LABS.map((lab) => (
              <a
                key={lab.name}
                href={lab.href}
                target={lab.href.startsWith("http") ? "_blank" : undefined}
                rel={
                  lab.href.startsWith("http")
                    ? "noopener noreferrer"
                    : undefined
                }
                className="group rounded-2xl border p-5 transition-transform hover:-translate-y-0.5"
                style={{
                  backgroundColor: `${T.boxBg}b8`,
                  borderColor: `${T.borderColor}55`,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="p-2.5 rounded-xl"
                    style={{
                      backgroundColor: `${T.accentColor}16`,
                      color: T.accentColor,
                    }}
                  >
                    <Upload size={20} />
                  </div>
                  <ArrowUpRight
                    size={18}
                    className="opacity-40 group-hover:opacity-100"
                  />
                </div>
                <div
                  className="mt-4 text-[10px] font-black uppercase tracking-widest"
                  style={{ color: T.accentColor }}
                >
                  {lab.badge}
                </div>
                <h3
                  className="font-black text-lg mt-1"
                  style={{ color: T.headerColor }}
                >
                  {lab.name}
                </h3>
                <p className="text-sm opacity-65 mt-2 leading-relaxed">
                  {lab.description}
                </p>
                {lab.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lab.image}
                    alt={`${lab.name} systems`}
                    className="mt-4 h-10 w-auto rounded-md object-contain object-left opacity-90"
                  />
                ) : (
                  <p className="text-[10px] font-bold opacity-45 mt-4 uppercase tracking-wider">
                    {lab.systems}
                  </p>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      {!selectedGame && (
        <section
          className="py-6 border-b"
          style={{ borderColor: `${T.borderColor}50` }}
        >
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <div
                className="text-[10px] font-black uppercase tracking-[0.22em]"
                style={{ color: T.accentColor }}
              >
                Play next
              </div>
              <h2
                className="mt-1 text-xl font-black"
                style={{ color: T.headerColor }}
              >
                Scroll through the arcade
              </h2>
            </div>
            <span className="text-[10px] font-bold opacity-45">
              Swipe or use your trackpad →
            </span>
          </div>
          <div
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 scrollbar-hide"
            style={{ scrollbarWidth: "none" }}
          >
            {GAME_LIBRARY.map((game) => (
              <button
                key={`rail-${game.id}`}
                type="button"
                onClick={() => launchGame(game)}
                className="group relative aspect-4/3 w-[230px] shrink-0 snap-start overflow-hidden rounded-2xl border text-left sm:w-[280px]"
                style={{
                  borderColor: `${T.borderColor}55`,
                  backgroundColor: T.boxBg,
                }}
                aria-label={`Play ${game.title}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={game.coverUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-linear-to-t from-black/75 via-transparent to-transparent" />
                <span className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <span>
                    <span className="block text-sm font-black text-white">
                      {game.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-white/60">
                      {game.category} · {game.players}P
                    </span>
                  </span>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg">
                    <Play size={15} fill="currentColor" />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
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
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl mb-4">🎮</div>
                    <p className="text-sm opacity-60 mb-4">
                      No playable game available.
                    </p>
                    <p className="text-[10px] opacity-40 max-w-md">
                      This game is configured for HTML5. Check back later for
                      updates.
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
                    🛡️ {selectedGame.licenseLabel}
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
        className="sticky top-0 z-20 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between py-4 border-b backdrop-blur-md"
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
            id="games-search"
            name="gamesSearch"
            type="text"
            placeholder="Search games or describe a scene to create..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border bg-transparent text-sm outline-none focus:border-cyan-500/50"
            style={{ borderColor: T.borderColor, color: T.textColor }}
          />
        </div>

        {/* Prompt randomizer */}
        <button
          onClick={() => router.push(studioImageHref)}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition hover:opacity-80"
          style={{ borderColor: `${T.accentColor}60`, color: T.accentColor }}
          title="Generate a game-themed image"
        >
          <Shuffle size={11} /> Surprise me
        </button>

        {/* Category Filters */}
        <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1">
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
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 py-6"
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
              onClick={() => launchGame(game)}
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
                {game.launchMode === "embedded" ? "Play here" : "New tab"}
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
                <span>👤 {game.players}P</span>
                <span>{game.year}</span>
              </div>
              <div
                className="flex items-center justify-between gap-2 mt-3 pt-3 border-t"
                style={{ borderColor: `${T.borderColor}35` }}
              >
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide"
                  style={{
                    color:
                      game.license === "open-source"
                        ? "#34d399"
                        : T.accentColor,
                  }}
                >
                  <ShieldCheck size={11} /> {game.licenseLabel}
                </span>
                {game.sourceUrl && (
                  <a
                    href={game.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`View ${game.title} source`}
                    className="opacity-45 hover:opacity-100"
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

      <section className="grid sm:grid-cols-2 gap-3 pb-8">
        {FREE_DISCOVERY.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border p-4 hover:opacity-80"
            style={{ borderColor: `${T.borderColor}45` }}
          >
            <div>
              <div
                className="text-sm font-bold"
                style={{ color: T.headerColor }}
              >
                {item.label}
              </div>
              <div className="text-xs opacity-50 mt-0.5">{item.detail}</div>
            </div>
            <ExternalLink size={15} className="opacity-45" />
          </a>
        ))}
      </section>
    </PageShell>
  );
}
