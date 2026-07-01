const categories = [
  "Arcade",
  "Puzzle",
  "Retro",
  "Racing",
  "Strategy",
  "Multiplayer",
  "Shooter",
  "More",
];

export default function CategoryChips() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-black text-white">Browse by Category</h2>

      <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
        {categories.map((cat) => (
          <button
            key={cat}
            className="rounded-2xl bg-white/5 border border-white/10 py-4 text-xs font-bold text-white hover:bg-white/10 hover:border-orange-500/50 transition-all"
          >
            {cat}
          </button>
        ))}
      </div>
    </section>
  );
}
