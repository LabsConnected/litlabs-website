export default function GameHero() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-orange-500/20 bg-linear-to-br from-purple-950 via-slate-950 to-orange-950 p-6 min-h-[260px]">
      <div className="relative z-10 max-w-sm">
        <p className="text-xs text-purple-300 font-black">THIS WEEK</p>
        <h2 className="text-4xl font-black mt-3 leading-tight text-white">
          HEXTIS TOURNAMENT
        </h2>
        <p className="text-sm text-slate-300 mt-2">
          Compete for prizes, XP, LiTTs, and leaderboard glory.
        </p>
        <button className="mt-5 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-black hover:bg-orange-400 transition-colors">
          Play Now
        </button>
      </div>

      <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_70%_30%,#ff7a00,transparent_35%),radial-gradient(circle_at_30%_70%,#7c3aed,transparent_40%)]" />
    </section>
  );
}
