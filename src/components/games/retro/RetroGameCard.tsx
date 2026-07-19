"use client";

import Link from "next/link";
import { Heart, Play, Trash2, ImagePlus } from "lucide-react";
import { formatRomSize, getRetroSystem, type RetroGameRecord } from "@/lib/retro-arcade";
import RetroArtwork from "./RetroArtwork";

type Props = {
  game: RetroGameRecord;
  onToggleFavorite?: (game: RetroGameRecord) => void;
  onRemove?: (game: RetroGameRecord) => void;
  onManageArtwork?: (game: RetroGameRecord) => void;
};

export default function RetroGameCard({ game, onToggleFavorite, onRemove, onManageArtwork }: Props) {
  const system = getRetroSystem(game.system);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#101017] transition hover:-translate-y-1 hover:border-white/20">
      <Link
        href={`/games/retro/play/${game.id}`}
        className="relative block aspect-3/4 overflow-hidden"
        aria-label={`Play ${game.title}`}
      >
        <RetroArtwork
          system={game.system}
          title={game.title}
          subtitle={game.subtitle}
          accent={game.artworkAccent}
          customArtworkUrl={game.customArtworkUrl}
          ratio="cover"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
        <span
          className="absolute left-2 top-2 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider backdrop-blur-sm"
          style={{ color: system.color }}
        >
          {system.shortName}
        </span>
        {game.favorite && (
          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-pink-500/80 text-white shadow-lg">
            <Heart size={12} fill="currentColor" />
          </span>
        )}
        <span className="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black opacity-0 shadow-xl transition group-hover:opacity-100">
          <Play size={16} fill="currentColor" />
        </span>
      </Link>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-white">{game.title}</h3>
            <p className="mt-0.5 truncate text-[11px] text-white/35">
              {formatRomSize(game.size)} · {game.launches} {game.launches === 1 ? "launch" : "launches"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onManageArtwork && (
              <button
                onClick={() => onManageArtwork(game)}
                className="rounded-md p-1.5 text-white/25 transition hover:bg-white/10 hover:text-white"
                aria-label={`Manage artwork for ${game.title}`}
              >
                <ImagePlus size={14} />
              </button>
            )}
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(game)}
                className={`rounded-md p-1.5 transition ${game.favorite ? "text-pink-400" : "text-white/25 hover:bg-white/10 hover:text-white"}`}
                aria-label={game.favorite ? `Unfavorite ${game.title}` : `Favorite ${game.title}`}
              >
                <Heart size={14} fill={game.favorite ? "currentColor" : "none"} />
              </button>
            )}
            {onRemove && (
              <button
                onClick={() => onRemove(game)}
                className="rounded-md p-1.5 text-white/25 transition hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-300"
                aria-label={`Remove ${game.title}`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
