"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import {
  Search,
  Gamepad2,
  Heart,
  Play,
  ExternalLink,
  Wand2,
  ShieldCheck,
  Code2,
  X,
  Maximize2,
  Minimize2,
  RotateCw,
} from "lucide-react";
import {
  GAME_LIBRARY,
  getFavorites,
  toggleFavorite,
  searchGames,
  type Game,
} from "@/lib/games";
import { listRetroGames, type RetroGameRecord } from "@/lib/retro-arcade";
import { RetroArcadeHero } from "@/components/games/RetroArcadeHero";
import { RetroArcadeEmbedded } from "@/components/games/RetroArcadeEmbedded";

export default function GamesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return getFavorites();
  });
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [recentRetro, setRecentRetro] = useState<RetroGameRecord | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  const closeGame = useCallback(() => {
    setSelectedGame(null);
    setIframeLoaded(false);
    setIframeError(null);
    setIsFullscreen(false);
  }, []);

  // If the iframe doesn't load within 15s, show a fallback message
  useEffect(() => {
    if (!selectedGame || iframeLoaded || iframeError) return;
    const timer = window.setTimeout(() => {
      if (!iframeLoaded) {
        setIframeError("This game is taking too long to load. It may block embedding — try opening in a new tab.");
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [selectedGame, iframeLoaded, iframeError]);

  // Escape key closes the overlay; scroll lock prevents background scrolling
  useEffect(() => {
    if (!selectedGame) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          closeGame();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [selectedGame, isFullscreen, closeGame]);

  // Focus the iframe immediately after it loads so keyboard input reaches the game
  useEffect(() => {
    if (iframeLoaded && iframeRef.current) {
      try {
        iframeRef.current.focus();
        // Some browsers need a second attempt
        const t = setTimeout(() => iframeRef.current?.focus(), 100);
        return () => clearTimeout(t);
      } catch {
        // cross-origin — focus may be blocked, but try anyway
      }
    }
  }, [iframeLoaded]);

  // Track native fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = playerContainerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen may be blocked — toggle the CSS fallback
      setIsFullscreen((v) => !v);
    }
  }, []);

  const reloadIframe = useCallback(() => {
    if (!iframeRef.current) return;
    setIframeLoaded(false);
    setIframeError(null);
    const src = iframeRef.current.src;
    iframeRef.current.src = "about:blank";
    setTimeout(() => {
      if (iframeRef.current) iframeRef.current.src = src;
    }, 50);
  }, []);

  useEffect(() => {
    listRetroGames()
      .then((games) => {
        const played = games.find((g) => g.lastPlayedAt);
        if (played) setRecentRetro(played);
      })
      .catch(() => {});
  }, []);

  const launchGame = useCallback((game: Game) => {
    if (!game.html5Url) return;
    if (game.launchMode === "new-tab") {
      window.open(game.html5Url, "_blank", "noopener,noreferrer");
      return;
    }
    setIframeLoaded(false);
    setIframeError(null);
    setSelectedGame(game);
  }, []);

  const filteredGames = searchQuery ? searchGames(searchQuery) : GAME_LIBRARY;

  const handleToggleFav = useCallback((gameId: string) => {
    const isNowFav = toggleFavorite(gameId);
    setFavorites((prev) =>
      isNowFav ? [...prev, gameId] : prev.filter((id) => id !== gameId),
    );
  }, []);


  return (
    <PageShell>
      <main className="min-h-screen bg-[#070812] text-white">
        {/* === GAME CLOUD HERO === */}
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(249,115,22,.12),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(168,85,247,.1),transparent_35%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
            <p className="text-xs font-black uppercase tracking-[.3em] text-orange-400">Game Cloud</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Play instantly.</h1>
            <p className="mt-3 max-w-xl text-base text-white/55">Bring games you legally own. Build your own with LiTT.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/games/retro" className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-black transition hover:bg-orange-400">
                <Gamepad2 size={16} /> Open Retro Arcade
              </Link>
              <Link href="#quick-play" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10">
                <Play size={16} fill="currentColor" /> Quick Play
              </Link>
              <Link href="/studio?tool=image" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-bold text-white/70 transition hover:bg-white/5 hover:text-white">
                <Wand2 size={16} /> Build a Game
              </Link>
            </div>
            <div className="mt-5 text-[11px] font-medium text-white/35">
              Instant browser games · Private local ROM storage · Keyboard, touch and gamepad
            </div>
          </div>
        </section>

        {/* === CONTINUE PLAYING === */}
        {recentRetro && (
          <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-[.25em] text-orange-400">Continue Playing</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">Pick up where you left off</h2>
            </div>
            <Link href={`/games/retro/play/${recentRetro.id}`} className="group relative flex min-h-32 items-center overflow-hidden rounded-2xl border border-orange-400/20 bg-linear-to-r from-orange-950 via-[#15100a] to-transparent p-5 transition hover:border-orange-400/40">
              <div className="relative z-10 flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">
                  <Gamepad2 size={24} />
                </span>
                <div>
                  <h3 className="text-lg font-black">{recentRetro.title}</h3>
                  <p className="text-xs text-white/45">Retro Arcade · Last played on this device</p>
                </div>
                <span className="ml-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-black text-black">
                  <Play size={13} fill="currentColor" /> Resume
                </span>
              </div>
            </Link>
          </section>
        )}

        {/* === LiTT RETRO ARCADE — EMBEDDED STANDARD === */}
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <RetroArcadeHero variant="banner" />
          <div className="mt-6">
            <RetroArcadeEmbedded />
          </div>
        </section>

        {/* === PLAY-IN-LITT PROMISE === */}
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="mb-5">
            <p className="text-[10px] font-black uppercase tracking-[.25em] text-cyan-400">The LiTT play promise</p>
            <h2 className="mt-1 text-xl font-black sm:text-2xl">Less link-hopping. More playing.</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { title: "Curated, not dumped", detail: "Every title earns its place with real gameplay, clear controls, and quality cover art.", color: "#a8ff2f" },
              { title: "Play inside LiTTree", detail: "Featured games launch in the Game Cloud player whenever the publisher supports secure embedding.", color: "#65f4ff" },
              { title: "Private retro library", detail: "Your own legal cartridges stay in this browser with local saves and recovery controls.", color: "#a970ff" },
            ].map((item) => (
              <div key={item.title} className="relative overflow-hidden rounded-2xl border p-5" style={{ borderColor: `${item.color}28`, background: `linear-gradient(145deg, ${item.color}12, rgba(255,255,255,.02))` }}>
                <div className="mb-4 h-1.5 w-12 rounded-full" style={{ backgroundColor: item.color, boxShadow: `0 0 18px ${item.color}` }} />
                <h3 className="text-sm font-black text-white">{item.title}</h3>
                <p className="mt-2 text-xs leading-5 text-white/45">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* === BUILD A GAME IN STUDIO === */}
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-start gap-4 rounded-3xl border border-white/10 bg-linear-to-br from-violet-500/10 to-transparent p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.25em] text-violet-400">Build with LiTT</p>
              <h2 className="mt-2 text-xl font-black sm:text-2xl">Make your own game in Studio</h2>
              <p className="mt-2 max-w-md text-sm text-white/55">Use AI agents to design, code, and ship original mini-games — no engine setup required.</p>
            </div>
            <Link href="/studio?tool=image" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-400">
              <Wand2 size={16} /> Open Studio
            </Link>
          </div>
        </section>

        {/* === LEGAL / PRIVATE STORAGE NOTE === */}
        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/4 p-4">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-300" />
            <p className="text-xs leading-5 text-white/50">
              LiTTree does not provide commercial ROM files. Only import games you own or public-domain homebrew. Your imported files remain in your browser.
            </p>
          </div>
        </section>

        {/* === QUICK PLAY === */}
        <section id="quick-play" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.25em] text-orange-400">Quick Play</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">Browser games — no install</h2>
            </div>
            <div className="relative w-full max-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={14} />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-orange-500/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredGames.map((game) => (
              <article
                key={game.id}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/3 transition hover:-translate-y-1 hover:border-white/20"
                onClick={() => launchGame(game)}
              >
                <div className="relative aspect-4/3 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={game.coverUrl}
                    alt={`${game.title} cover art`}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23111"/><text x="50" y="50" text-anchor="middle" fill="%23555" font-size="40">🎮</text></svg>';
                    }}
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 transition group-hover:opacity-100" />
                  <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between opacity-0 transition group-hover:opacity-100">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg">
                      <Play size={15} fill="currentColor" />
                    </span>
                  </div>
                  <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white/70 backdrop-blur-sm">
                    {game.launchMode === "embedded" ? "Play here" : "New tab"}
                  </span>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-sm font-black">{game.title}</h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleFav(game.id); }}
                      className="shrink-0 text-white/20 transition hover:text-white"
                      aria-label={favorites.includes(game.id) ? `Unfavorite ${game.title}` : `Favorite ${game.title}`}
                    >
                      <Heart size={14} fill={favorites.includes(game.id) ? "#f97316" : "none"} className={favorites.includes(game.id) ? "text-orange-500" : ""} />
                    </button>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-white/40">{game.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-white/30">
                    <span className="capitalize">{game.category}</span>
                    <span>·</span>
                    <span>{game.players}P</span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {filteredGames.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-white/40">No games found matching &quot;{searchQuery}&quot;.</p>
              <button onClick={() => setSearchQuery("")} className="mt-3 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5">Clear search</button>
            </div>
          )}
        </section>

        {/* === GAME PLAYER OVERLAY === */}
        {selectedGame && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-2 backdrop-blur-md sm:p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeGame(); }}
          >
            <div
              ref={playerContainerRef}
              className={`relative w-full ${isFullscreen ? "h-full" : "max-w-5xl"}`}
            >
              {/* Header bar — hidden in fullscreen */}
              {!isFullscreen && (
                <div className="mb-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button onClick={closeGame} className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close game">
                      <X size={16} />
                    </button>
                    <div>
                      <div className="font-black">{selectedGame.title}</div>
                      <div className="text-[10px] text-white/40">{selectedGame.platform.toUpperCase()} · {selectedGame.licenseLabel}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={reloadIframe}
                      className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"
                      aria-label="Reload game"
                      title="Reload"
                    >
                      <RotateCw size={15} />
                    </button>
                    <button
                      onClick={toggleFullscreen}
                      className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"
                      aria-label="Toggle fullscreen"
                      title="Fullscreen"
                    >
                      <Maximize2 size={15} />
                    </button>
                    <button
                      onClick={() => handleToggleFav(selectedGame.id)}
                      className="rounded-lg border border-white/10 p-2 hover:bg-white/10"
                      style={{ color: favorites.includes(selectedGame.id) ? "#f97316" : "rgba(255,255,255,0.4)" }}
                      aria-label={favorites.includes(selectedGame.id) ? "Unfavorite" : "Favorite"}
                    >
                      <Heart size={16} fill={favorites.includes(selectedGame.id) ? "#f97316" : "none"} />
                    </button>
                  </div>
                </div>
              )}

              {/* Game viewport — flexible height instead of fixed aspect-video */}
              <div
                className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black ${isFullscreen ? "h-full rounded-none border-0" : ""}`}
                style={isFullscreen ? undefined : { minHeight: "500px", maxHeight: "80vh" }}
              >
                {selectedGame.html5Url ? (
                  <>
                    <iframe
                      ref={iframeRef}
                      title={`${selectedGame.title} game`}
                      src={selectedGame.html5Url}
                      className="h-full w-full border-0"
                      allow="autoplay; fullscreen; gamepad; pointer-lock; clipboard-read; clipboard-write"
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock allow-modals allow-downloads allow-popups-to-escape-sandbox"
                      referrerPolicy="origin"
                      onLoad={() => setIframeLoaded(true)}
                      onError={() => setIframeError("Failed to load game. Try opening in a new tab.")}
                    />
                    {!iframeLoaded && !iframeError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black">
                        <div className="text-center">
                          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                          <p className="mt-3 text-xs text-white/40">Loading {selectedGame.title}…</p>
                          <a
                            href={selectedGame.html5Url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-1.5 text-[10px] font-bold text-white/60 hover:bg-white/10 hover:text-white"
                          >
                            <ExternalLink size={11} /> Open in new tab
                          </a>
                        </div>
                      </div>
                    )}
                    {iframeError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black p-6 text-center">
                        <div className="max-w-sm space-y-3">
                          <p className="text-sm text-rose-300">{iframeError}</p>
                          <a
                            href={selectedGame.html5Url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-black"
                          >
                            <ExternalLink size={13} /> Open in new tab
                          </a>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-white/40">
                    <p>No playable game available.</p>
                  </div>
                )}

                {/* Fullscreen exit button — only visible in fullscreen */}
                {isFullscreen && (
                  <button
                    onClick={toggleFullscreen}
                    className="absolute right-3 top-3 z-10 rounded-lg border border-white/20 bg-black/60 p-2 text-white/80 backdrop-blur-sm hover:bg-black/80 hover:text-white"
                    aria-label="Exit fullscreen"
                    title="Exit fullscreen (Esc)"
                  >
                    <Minimize2 size={16} />
                  </button>
                )}
              </div>

              {/* Footer bar — hidden in fullscreen */}
              {!isFullscreen && (
                <div className="mt-2 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] text-white/40">
                  <span>👤 {selectedGame.players}P</span>
                  <span>🛡️ {selectedGame.licenseLabel}</span>
                  {selectedGame.sourceUrl && (
                    <a href={selectedGame.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white/70" aria-label={`View ${selectedGame.title} source`}>
                      <Code2 size={11} /> Source
                    </a>
                  )}
                  {selectedGame.html5Url && (
                    <a href={selectedGame.html5Url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-white/70">
                      <ExternalLink size={11} /> Open in new tab
                    </a>
                  )}
                  <span className="ml-auto text-white/25">Press Esc to close · Click outside to exit</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </PageShell>
  );
}
