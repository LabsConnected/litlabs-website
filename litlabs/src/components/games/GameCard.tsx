"use client";

import { Play, Trophy } from "lucide-react";
import type { Game } from "@/lib/games";

export default function GameCard({
  game,
  showProgress = false,
  onClick,
}: {
  game: Game;
  showProgress?: boolean;
  onClick?: () => void;
}) {
  return (
    <article
      onClick={onClick}
      className={`rounded-2xl overflow-hidden bg-white/5 border border-white/10 hover:border-orange-500/50 transition-all hover:scale-[1.02] group ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="aspect-video bg-gradient-to-br from-purple-900 to-orange-900 relative overflow-hidden">
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
          <Play size={32} className="text-orange-500" />
        </div>
      </div>

      <div className="p-3">
        <h3 className="font-black text-sm">{game.title}</h3>
        <p className="text-xs text-slate-400">{game.category}</p>

        <div className="flex items-center gap-3 mt-2 text-xs text-slate-300">
          <span className="flex items-center gap-1">
            <Trophy size={12} className="text-yellow-500" />
            {game.rating}
          </span>
          <span>👁 {game.plays}</span>
        </div>

        {showProgress && game.progress !== undefined && (
          <div className="mt-3">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500"
                style={{ width: `${game.progress}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          className="mt-3 w-full rounded-xl bg-orange-500 py-2 text-xs font-black text-black hover:bg-orange-400 transition-colors"
        >
          Play
        </button>
      </div>
    </article>
  );
}
