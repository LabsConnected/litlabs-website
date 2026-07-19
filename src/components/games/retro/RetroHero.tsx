"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { getRetroSystem, type RetroGameRecord } from "@/lib/retro-arcade";
import RetroArtwork from "./RetroArtwork";

type Props = {
  game: RetroGameRecord;
};

export default function RetroHero({ game }: Props) {
  const system = getRetroSystem(game.system);

  return (
    <Link
      href={`/games/retro/play/${game.id}`}
      className="group relative flex min-h-56 overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-linear-to-br from-violet-950 via-[#15101e] to-cyan-950 shadow-[0_25px_80px_rgba(0,0,0,.35)] sm:min-h-72"
      aria-label={`Continue playing ${game.title}`}
    >
      <div className="absolute inset-0">
        <RetroArtwork
          system={game.system}
          title={game.title}
          subtitle={game.subtitle}
          accent={game.artworkAccent}
          customArtworkUrl={game.customArtworkUrl}
          ratio="hero"
          className="h-full w-full object-cover opacity-40 transition-transform duration-700 group-hover:scale-105 group-hover:opacity-55"
        />
      </div>
      <div className="absolute inset-0 bg-linear-to-r from-[#07070b] via-[#07070b]/60 to-transparent" />
      <div className="relative z-10 flex max-w-xl flex-col justify-end p-6">
        <span className="mb-2 text-[10px] font-black uppercase tracking-[.25em] text-fuchsia-300">
          Continue playing
        </span>
        <h2 className="text-3xl font-black text-white sm:text-4xl">{game.title}</h2>
        <p className="mt-2 text-sm text-white/50">
          {system.name} · Stored locally
        </p>
        <span className="mt-4 flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-black text-black">
          <Play size={15} fill="currentColor" /> Resume chapter
        </span>
      </div>
    </Link>
  );
}
