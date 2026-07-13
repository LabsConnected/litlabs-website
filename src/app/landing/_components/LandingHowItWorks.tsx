const STEPS = [
  {
    n: "01",
    title: "Connect",
    desc: "Link a GitHub repo, pick a project, and tell LiTT what you want to build.",
    color: "from-cyan-400 to-blue-500",
  },
  {
    n: "02",
    title: "Direct",
    desc: "The Director agent breaks work into steps, assigns tools, and asks before acting.",
    color: "from-fuchsia-400 to-pink-500",
  },
  {
    n: "03",
    title: "Ship",
    desc: "Review diffs, approve, and deploy. One click from idea to production.",
    color: "from-amber-400 to-orange-500",
  },
];

export function LandingHowItWorks() {
  return (
    <section
      id="how"
      className="relative z-10 border-y border-white/5 bg-white/[0.01] px-6 py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300">
            <span className="h-px w-8 bg-fuchsia-400/40" />
            The loop
            <span className="h-px w-8 bg-fuchsia-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            From idea to shipped.
            <br />
            <span className="bg-gradient-to-r from-fuchsia-300 to-amber-300 bg-clip-text text-transparent">
              In three moves.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            No new vocabulary. No new paradigm. Just a tighter loop between you
            and a real, working artifact.
          </p>
        </div>

        <div className="relative grid gap-4 md:grid-cols-3">
          {/* connector line */}
          <div
            aria-hidden
            className="absolute left-1/2 top-12 hidden h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent md:block"
          />

          {STEPS.map((s) => (
            <div
              key={s.n}
              className="group relative overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-7 transition hover:border-white/15"
            >
              <div
                className={`mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${s.color} text-sm font-black text-black shadow-lg`}
              >
                {s.n}
              </div>
              <h3 className="mb-2 text-lg font-black tracking-tight text-white">
                {s.title}
              </h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
