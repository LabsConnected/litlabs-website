"use client";

import { useState, useMemo } from "react";
import { GAME_LIBRARY, searchGames, type Game } from "@/lib/games";
import GameHero from "./GameHero";
import GameCard from "./GameCard";
import CategoryChips from "./CategoryChips";
import DailyMissions from "./DailyMissions";
import FriendsPlaying from "./FriendsPlaying";
import MultiplayerRooms from "./MultiplayerRooms";
import MobileGameNav from "./MobileGameNav";
import { X, ExternalLink, Heart } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const QUICK_FILTERS = [
  "Continue",
  "Featured",
  "Trending",
  "Multiplayer",
  "Leaders",
];

export default function GameCloudHome() {
  const { resolvedColors: T } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  const filteredGames = useMemo(
    () => (searchQuery ? searchGames(searchQuery) : GAME_LIBRARY),
    [searchQuery],
  );

  const continueGames = GAME_LIBRARY.slice(0, 4);
  const featuredGames = GAME_LIBRARY.slice(0, 4);

  return (
    <main className="min-h-screen bg-[#070812] text-white pb-28">
      <section className="px-4 pt-5 space-y-5 max-w-7xl mx-auto">
        <div>
          <p className="text-sm text-orange-400 font-bold">
            🎮 LiTT Code Game Cloud
          </p>
          <h1 className="text-3xl font-black mt-2">Play instantly.</h1>
          <p className="text-sm text-slate-400">
            HTML5 arcade, puzzle, retro, and multiplayer games.
          </p>
        </div>

        <input
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
                onClick={() => setSelectedGame(game)}
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
                  onClick={() => setSelectedGame(game)}
                />
              ))}
            </div>
          </Section>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
                  href={selectedGame.html5Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg border hover:opacity-80"
                  style={{ borderColor: T.borderColor, color: T.textMuted }}
                  title="Open in new tab"
                >
                  <ExternalLink size={16} />
                </a>
                <button
                  onClick={() => setSelectedGame(null)}
                  className="p-2 rounded-lg border hover:opacity-80"
                  style={{ borderColor: T.borderColor, color: T.textMuted }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Game iframe */}
            <div className="aspect-video bg-black">
              {selectedGame.html5Url ? (
                <iframe
                  src={selectedGame.html5Url}
                  className="w-full h-full"
                  allow="fullscreen; gamepad"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  referrerPolicy="no-referrer"
                  style={{ border: "none" }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl mb-4">🎮</div>
                    <p className="text-sm opacity-60">
                      No playable link available.
                    </p>
                  </div>
                </div>
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
