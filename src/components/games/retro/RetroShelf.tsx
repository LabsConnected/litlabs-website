"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RetroGameRecord } from "@/lib/retro-arcade";
import RetroGameCard from "./RetroGameCard";

type Props = {
  title: string;
  subtitle?: string;
  games: RetroGameRecord[];
  onToggleFavorite?: (game: RetroGameRecord) => void;
  onRemove?: (game: RetroGameRecord) => void;
  onManageArtwork?: (game: RetroGameRecord) => void;
};

export default function RetroShelf({ title, subtitle, games, onToggleFavorite, onRemove, onManageArtwork }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: -1 | 1) {
    const container = scrollRef.current;
    if (!container) return;
    const cardWidth = 200;
    container.scrollBy({ left: direction * cardWidth * 2, behavior: "smooth" });
  }

  if (games.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">{title}</h2>
          {subtitle && <p className="text-xs text-white/40">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollBy(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => scrollBy(1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Scroll right"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {games.map((game) => (
          <div key={game.id} className="w-[180px] shrink-0 snap-start sm:w-[200px]">
            <RetroGameCard
              game={game}
              onToggleFavorite={onToggleFavorite}
              onRemove={onRemove}
              onManageArtwork={onManageArtwork}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
