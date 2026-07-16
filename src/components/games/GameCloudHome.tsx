"use client";

import { useState, useMemo, useEffect } from "react";
import {
  GAME_LIBRARY,
  searchGames,
  type Game,
  type GamePlatform,
} from "@/lib/games";

const EXTERNAL_PLATFORMS: GamePlatform[] = ["browser", "emulator", "dos"];
import GameHero from "./GameHero";
import GameCard from "./GameCard";
import CategoryChips from "./CategoryChips";
import DailyMissions from "./DailyMissions";
import FriendsPlaying from "./FriendsPlaying";
import MultiplayerRooms from "./MultiplayerRooms";
import MobileGameNav from "./MobileGameNav";
import { X, ExternalLink, AlertTriangle } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const QUICK_FILTERS = [
  "Continue",
  "Featured",
  "Trending",
  "Multiplayer",
  "Leaders",
];

function openGameExternally(game: Game) {
  const url = game.externalUrl || game.html5Url;
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function GameCloudHome() {
  const { resolvedColors: T } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [iframeError, setIframeError] = useState(false);

  const handlePlay = (game: Game) => {
    if (EXTERNAL_PLATFORMS.includes(game.platform)) {
      openGameExternally(game);
      return;
    }
    setIframeError(false);
    setSelectedGame(game);
  };

  const filteredGames = useMemo(
    () => (searchQuery ? searchGames(searchQuery) : GAME_LIBRARY),
    [searchQuery],
  );

  const continueGames = GAME_LIBRARY.slice(0, 4);
  const featuredGames = GAME_LIBRARY.slice(0, 4);

  // Scan which games cannot be safely embedded
  const scan = useMemo(() => {
    const externalOnly = GAME_LIBRARY.filter((g) =>
      EXTERNAL_PLATFORMS.includes(g.platform),
    );
    const iframeReady = GAME_LIBRARY.filter(
      (g) => !EXTERNAL_PLATFORMS.includes(g.platform) && g.html5Url,
    );
    const broken = GAME_LIBRARY.filter((g) => !g.html5Url && !g.externalUrl);
    return { externalOnly, iframeReady, broken };
  }, []);

  useEffect(() => {
    console.table(
      GAME_LIBRARY.map((g) => ({
        title: g.title,
        platform: g.platform,
        embedsInline: !EXTERNAL_PLATFORMS.includes(g.platform),
        url: g.html5Url || g.externalUrl || "missing",
      })),
    );
  }, []);

  return (
    <main className="min-h-dvh bg-[#070812] text-white pb-[calc(112px+env(safe-area-inset-bottom))]">
      <section className="px-4 pt-5 space-y-5 max-w-7xl mx-auto">
        <div>
          <p className="text-sm text-orange-400 font-bold">
            🎮 LiTTree Game Cloud
          </p>
          <h1 className="text-3xl font-black mt-2">Play instantly.</h1>
          <p className="text-sm text-slate-400">
            HTML5 arcade, puzzle, retro, and multiplayer games.
          </p>
        </div>

        <input
          id="game-cloud-search"
          name="gameCloudSearch"
          type="text"
          placeholder="Search games..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-orange-500/50 transition-colors text-white placeholder:text-slate-500"
        />

        <GameHero />

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {QUICK_FILTERS.map((item) => (
            <button
              key={item}
              aria-label={`Filter by ${item}`}
              className="rounded-2xl bg-white/5 border border-white/10 px-3 py-4 text-sm font-bold text-white hover:bg-white/10 hover:border-orange-500/50 transition-all"
            >
              {item}
            </button>
          ))}
        </div>

        <Section title={searchQuery ? "Search Results" : "Continue Playing"}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(searchQuery ? filteredGames : continueGames).map((game) => (
              <GameCard
                key={game.id}
                game={game}
                showProgress={!searchQuery}
                onClick={() => handlePlay(game)}
              />
            ))}
          </div>
        </Section>

        {!searchQuery && (
          <Section title="Featured Games">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {featuredGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  onClick={() => handlePlay(game)}
                />
              ))}
            </div>
          </Section>
        )}

        {scan.externalOnly.length > 0 && (
          <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 p-3 text-xs text-orange-200">
            <span className="font-black uppercase tracking-wider">
              Compatibility scan:
            </span>{" "}
            {scan.iframeReady.length} game(s) embed inline.{" "}
            {scan.externalOnly.length} game(s)/hub(s) open in a new tab
            (emulators, external hubs, and publishers that block iframes).{" "}
            {scan.broken.length > 0 && `${scan.broken.length} have no URL.`}
          </div>
        )}

        <CategoryChips />

        <div className="grid md:grid-cols-3 gap-4">
          <DailyMissions />
          <FriendsPlaying />
          <MultiplayerRooms />
        </div>
      </section>

      <MobileGameNav />

      {/* Game Player Overlay */}
      {selectedGame && (
        <div
          className="fixed inset-0 z-120 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
        >
          <div
            className="w-full max-w-5xl rounded-2xl overflow-hidden border"
            style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 border-b"
              style={{ borderColor: T.borderColor }}
            >
              <div>
                <h2 className="font-black" style={{ color: T.headerColor }}>
                  {selectedGame.title}
                </h2>
                <p
                  className="text-xs opacity-60"
                  style={{ color: T.textMuted }}
                >
                  {selectedGame.platform.toUpperCase()} • {selectedGame.year} •{" "}
                  {selectedGame.developer}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={selectedGame.externalUrl || selectedGame.html5Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg border hover:opacity-80"
                  style={{ borderColor: T.borderColor, color: T.textMuted }}
                  title="Open in new tab"
                >
                  <ExternalLink size={16} />
                </a>
                <button
                  onClick={() => {
                    setIframeError(false);
                    setSelectedGame(null);
                  }}
                  className="p-2 rounded-lg border hover:opacity-80"
                  style={{ borderColor: T.borderColor, color: T.textMuted }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Game iframe */}
            <div className="aspect-video bg-black">
              {iframeError || !selectedGame.html5Url ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
                  <AlertTriangle size={40} className="text-orange-400" />
                  <div>
                    <p className="text-sm font-bold text-white">
                      This game can&apos;t be embedded here.
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      The publisher blocks iframe loading. Open it in a new tab
                      to play.
                    </p>
                  </div>
                  <button
                    onClick={() => openGameExternally(selectedGame)}
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-black hover:bg-orange-400 transition-colors"
                  >
                    <ExternalLink size={14} /> Open Game
                  </button>
                </div>
              ) : (
                <iframe
                  src={selectedGame.html5Url}
                  className="w-full h-full"
                  allow="fullscreen; gamepad"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  referrerPolicy="no-referrer"
                  onError={() => setIframeError(true)}
                  onLoad={(e) => {
                    // Some publishers still render a blank/blocked page inside
                    // the iframe. Give them a moment, then check accessibility.
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                      (e.target as HTMLIFrameElement).contentWindow?.document;
                    } catch {
                      setIframeError(true);
                    }
                  }}
                  style={{ border: "none" }}
                />
              )}
            </div>

            {/* Info bar */}
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex items-center gap-4 text-xs"
                style={{ color: T.textMuted }}
              >
                <span>⭐ {selectedGame.rating}</span>
                <span>👤 {selectedGame.players}P</span>
                <span>👁 {selectedGame.plays}</span>
              </div>
              <div className="flex gap-2">
                {selectedGame.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 rounded-md text-[10px] border uppercase font-bold"
                    style={{ borderColor: T.borderColor, color: T.textMuted }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-white">{title}</h2>
        <button className="text-xs text-orange-400 font-bold hover:text-orange-300 transition-colors">
          View all
        </button>
      </div>
      {children}
    </section>
  );
}
