const STATS = [
  {
    value: "9,999+",
    label: "LBC in circulation",
    from: "from-cyan-300",
    to: "to-blue-400",
    glow: "group-hover:shadow-cyan-500/20",
  },
  {
    value: "99.9%",
    label: "Platform uptime",
    from: "from-emerald-300",
    to: "to-teal-400",
    glow: "group-hover:shadow-emerald-500/20",
  },
  {
    value: "<300ms",
    label: "P95 agent latency",
    from: "from-fuchsia-300",
    to: "to-pink-400",
    glow: "group-hover:shadow-fuchsia-500/20",
  },
  {
    value: "24/7",
    label: "Always-on crew",
    from: "from-amber-300",
    to: "to-orange-400",
    glow: "group-hover:shadow-amber-500/20",
  },
];

export function LandingStats() {
  return (
    <section className="relative z-10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              className={`group relative overflow-hidden rounded-2xl border border-white/8 bg-linear-to-b from-white/4 to-white/1 p-6 text-center shadow-lg transition-all duration-300 hover:border-white/20 hover:scale-[1.02] ${s.glow}`}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/0 to-white/0 transition duration-500 group-hover:from-white/2 group-hover:to-white/4"
              />
              <div className="relative">
                <div
                  className={`bg-linear-to-r ${s.from} ${s.to} bg-clip-text font-mono text-3xl font-black tracking-tight text-transparent md:text-4xl`}
                >
                  {s.value}
                </div>
                <div className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                  {s.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
