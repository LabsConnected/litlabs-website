export default function MultiplayerRooms() {
  const rooms = [
    ["Snake Arena", "23 players online"],
    ["Chess Master", "2 players waiting"],
    ["UNO Online", "15 players online"],
  ];

  return (
    <section className="rounded-2xl bg-white/5 border border-white/10 p-4">
      <h2 className="font-black mb-4 text-white">Multiplayer</h2>

      <div className="space-y-3">
        {rooms.map(([name, status]) => (
          <div key={name} className="flex justify-between items-center">
            <div>
              <p className="text-sm font-bold text-white">{name}</p>
              <p className="text-xs text-slate-400">{status}</p>
            </div>
            <button className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-black text-black hover:bg-orange-400 transition-colors">
              Join
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
