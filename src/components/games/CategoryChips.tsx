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
            className="rounded-2xl bg-[#0e1510]/5 border border-[#0e1510]/10 py-4 text-xs font-bold text-white hover:bg-[#0e1510]/10 hover:border-orange-500/50 transition-all"
          >
            {cat}
          </button>
        ))}
      </div>
    </section>
  );
}
