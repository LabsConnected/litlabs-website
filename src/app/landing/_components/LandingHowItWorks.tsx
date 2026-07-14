const STEPS = [
  {
    n: "01",
    title: "Connect",
    color: "#30e7ff",
    tag: "Setup",
    desc: "Connect GitHub, upload project files, or start blank. LiTT maps your repository, detects the stack, and prepares the workspace.",
  },
  {
    n: "02",
    title: "Command",
    color: "#a855f7",
    tag: "Direct",
    desc: "Tell LiTT what you want in plain language. Build a page. Fix a bug. Create an image. Research a feature. Prepare a launch.",
  },
  {
    n: "03",
    title: "Plan",
    color: "#f472b6",
    tag: "Orchestrate",
    desc: "LiTT Director breaks the mission into clear steps and assigns the right agents. Nothing important happens silently.",
  },
  {
    n: "04",
    title: "Build",
    color: "#f97316",
    tag: "Execute",
    desc: "Your crew edits files, generates assets, runs commands, creates artifacts, and updates the live preview in real time.",
  },
  {
    n: "05",
    title: "Verify",
    color: "#f59e0b",
    tag: "Check",
    desc: "LiTT runs checks, reviews screenshots, tests responsive layouts, identifies failures, and corrects the result automatically.",
  },
  {
    n: "06",
    title: "Ship",
    color: "#34d399",
    tag: "Deploy",
    desc: "Review the diff, approve the mission, open a pull request, or deploy directly. One verified result — ready to ship.",
  },
];

export function LandingHowItWorks() {
  return (
    <section
      id="how"
      className="relative z-10 border-y border-white/5 px-4 py-24 md:py-32"
      style={{ background: "rgba(255,255,255,0.01)" }}
    >
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300">
            <span className="h-px w-8" style={{ background: "rgba(249,115,22,0.4)" }} />
            The execution loop
            <span className="h-px w-8" style={{ background: "rgba(249,115,22,0.4)" }} />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            One mission. One crew.
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(110deg, #f97316 0%, #a855f7 50%, #30e7ff 100%)",
              }}
            >
              One verified result.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            Every step is visible. Every action requires approval at critical points.
            No invisible magic — just a tighter loop between your idea and a working artifact.
          </p>
        </div>

        {/* Steps grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className="group relative overflow-hidden rounded-2xl border border-white/8 p-7 transition-all duration-300 hover:border-white/15"
              style={{
                background: "linear-gradient(145deg, rgba(255,255,255,0.02), transparent)",
              }}
            >
              {/* Hover glow */}
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{
                  background: `radial-gradient(circle at 30% 30%, ${s.color}15, transparent 60%)`,
                }}
              />

              <div className="relative">
                <div className="mb-5 flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-black text-black shadow-lg shrink-0"
                    style={{ background: s.color }}
                  >
                    {s.n}
                  </div>
                  <span
                    className="rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest"
                    style={{
                      borderColor: `${s.color}30`,
                      color: s.color,
                      background: `${s.color}0d`,
                    }}
                  >
                    {s.tag}
                  </span>
                </div>

                <h3 className="mb-2.5 text-lg font-black tracking-tight text-white">
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed text-neutral-400">{s.desc}</p>

                {/* Arrow connector — only on last step show check */}
                {i === 5 && (
                  <div className="mt-4 flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Mission complete
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
