"use client";

import { GAME_LIBRARY } from "@/lib/games";
import GameHero from "./GameHero";
import GameCard from "./GameCard";
import CategoryChips from "./CategoryChips";
import DailyMissions from "./DailyMissions";
import FriendsPlaying from "./FriendsPlaying";
import MultiplayerRooms from "./MultiplayerRooms";
import MobileGameNav from "./MobileGameNav";

export default function GameCloudHome() {
  return (
    <main className="min-h-screen bg-[#070812] text-white pb-28">
      <section className="px-4 pt-5 space-y-5 max-w-7xl mx-auto">
        <div>
          <p className="text-sm text-orange-400 font-bold">🎮 LiTTree Game Cloud</p>
          <h1 className="text-3xl font-black mt-2">Play instantly.</h1>
          <p className="text-sm text-slate-400">HTML5 arcade, puzzle, retro, and multiplayer games.</p>
        </div>

        <input
          placeholder="Search games..."
          className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-orange-500/50 transition-colors text-white placeholder:text-slate-500"
        />

        <GameHero />

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {["Continue", "Featured", "Trending", "Multiplayer", "Leaders"].map((item) => (
            <button
              key={item}
              className="rounded-2xl bg-white/5 border border-white/10 px-3 py-4 text-sm font-bold text-white hover:bg-white/10 hover:border-orange-500/50 transition-all"
            >
              {item}
            </button>
          ))}
        </div>

        <Section title="Continue Playing">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {GAME_LIBRARY.slice(0, 4).map((game) => (
              <GameCard key={game.id} game={game} showProgress />
            ))}
          </div>
        </Section>

        <Section title="Featured Games">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {GAME_LIBRARY.slice(0, 4).map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </Section>

        <CategoryChips />

        <div className="grid md:grid-cols-3 gap-4">
          <DailyMissions />
          <FriendsPlaying />
          <MultiplayerRooms />
        </div>
      </section>

      <MobileGameNav />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
