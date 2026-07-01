export default function DailyMissions() {
  const missions = [
    ["Play 3 Games", "+100"],
    ["Beat 1 Puzzle Game", "+150"],
    ["Score 20,000 Points", "+200"],
  ];

  return (
    <section className="rounded-2xl bg-white/5 border border-white/10 p-4">
      <h2 className="font-black mb-4 text-white">Daily Missions</h2>

      <div className="space-y-3">
        {missions.map(([name, reward]) => (
          <div key={name} className="flex justify-between text-sm text-slate-300">
            <span>{name}</span>
            <span className="text-orange-400 font-bold">{reward}</span>
          </div>
        ))}
      </div>

      <button className="mt-4 w-full rounded-xl bg-white/10 py-2 text-sm font-bold text-white hover:bg-white/20 transition-colors">
        View All Missions
      </button>
    </section>
  );
}
