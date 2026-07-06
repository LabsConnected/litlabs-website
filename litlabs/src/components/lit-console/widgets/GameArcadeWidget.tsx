"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Gamepad2, Play, Clock } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { GamePlayerOverlay } from "@/components/games/GamePlayerOverlay";
import {
  getFeaturedGames,
  getLastPlayedGameId,
  getGameById,
  type Game,
} from "@/lib/games";

export function GameArcadeWidget() {
  const { resolvedColors: T } = useTheme();
  const featured = getFeaturedGames(4);
  const [lastPlayed, setLastPlayed] = useState<Game | undefined>(undefined);
  const [selected, setSelected] = useState<Game | undefined>(undefined);

  useEffect(() => {
    const lastId = getLastPlayedGameId();
    if (lastId) setLastPlayed(getGameById(lastId));
  }, []);

  return (
    <BentoCard
      title="Game Arcade"
      icon={<Gamepad2 size={14} />}
      action={
        <Link
          href="/games/cloud"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: T.accentColor }}
        >
          Open Arcade
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        {lastPlayed && (
          <div
            className="flex items-center justify-between rounded-xl border p-2.5"
            style={{
              borderColor: `${T.accentColor}30`,
              backgroundColor: `${T.accentColor}10`,
            }}
          >
            <div className="flex items-center gap-2">
              <Clock size={14} style={{ color: T.accentColor }} />
              <div>
                <div
                  className="text-xs font-bold"
                  style={{ color: T.textColor }}
                >
                  Continue: {lastPlayed.title}
                </div>
                <div className="text-[9px]" style={{ color: T.textMuted }}>
                  {lastPlayed.category} • {lastPlayed.difficulty}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelected(lastPlayed)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <Play size={10} /> Play
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {featured.map((game) => (
            <button
              key={game.id}
              onClick={() => setSelected(game)}
              className="group relative overflow-hidden rounded-xl border text-left transition hover:scale-[1.02]"
              style={{
                borderColor: `${T.borderColor}25`,
                backgroundColor: `${T.borderColor}08`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={game.coverUrl}
                alt={game.title}
                className="aspect-video w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/><text x="50" y="50" text-anchor="middle" fill="%23666" font-size="40">🎮</text></svg>';
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100 bg-black/50">
                <Play size={24} style={{ color: T.accentColor }} />
              </div>
              <div className="p-2">
                <div
                  className="text-xs font-bold"
                  style={{ color: T.textColor }}
                >
                  {game.title}
                </div>
                <div className="text-[9px]" style={{ color: T.textMuted }}>
                  {game.difficulty} • {game.controls?.join(" / ")}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <GamePlayerOverlay
          game={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
    </BentoCard>
  );
}
