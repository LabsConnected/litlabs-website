const STATS = [
  { value: "9,999+", label: "LBC in circulation" },
  { value: "99.9%", label: "Platform uptime" },
  { value: "<300ms", label: "P95 agent latency" },
  { value: "24/7", label: "Always-on crew" },
];

export function LandingStats() {
  return (
    <section className="relative z-10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="group relative overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 text-center transition hover:border-white/15"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/0 via-fuchsia-500/0 to-amber-400/0 transition group-hover:from-cyan-500/5 group-hover:via-fuchsia-500/5 group-hover:to-amber-400/5"
              />
              <div className="relative">
                <div className="bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-amber-300 bg-clip-text font-mono text-3xl font-black tracking-tight text-transparent md:text-4xl">
                  {s.value}
                </div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
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
