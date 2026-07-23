const NODES = [
  {
    symbol: "🌱",
    concept: "Roots",
    color: "#30e7ff",
    label: "Memory",
    desc: "Past decisions, project knowledge, and saved context that persist across every mission.",
  },
  {
    symbol: "🌿",
    concept: "Branches",
    color: "#a855f7",
    label: "Agents",
    desc: "Specialized workers — Forge, Visionary, Research Beast, QA Goblin — handling different parts of the mission.",
  },
  {
    symbol: "🍃",
    concept: "Leaves",
    color: "#f59e0b",
    label: "Active tasks",
    desc: "The work currently running across your project. Each leaf is a live step in the mission.",
  },
  {
    symbol: "🍊",
    concept: "Fruit",
    color: "#34d399",
    label: "Shipped output",
    desc: "Pages, applications, images, agents, releases, and deployments. Every approved result becomes part of the system.",
  },
];

const STATS = [
  { value: "12", label: "Agents", color: "#a855f7" },
  { value: "38", label: "Projects", color: "#30e7ff" },
  { value: "146", label: "Artifacts", color: "#f59e0b" },
  { value: "22K", label: "Views", color: "#34d399" },
  { value: "4", label: "Deployments", color: "#f472b6" },
  { value: "Lv 18", label: "Creator Level", color: "#f97316" },
];

export function LandingTreeOS() {
  return (
    <section className="relative z-10 overflow-hidden border-y border-white/5 px-4 py-24 md:py-32">
      {/* Background tree silhouette glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, rgba(168,85,247,0.07) 0%, transparent 65%), radial-gradient(ellipse at 20% 80%, rgba(48,231,255,0.05) 0%, transparent 50%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-purple-300">
            <span className="h-px w-8 bg-purple-400/40" />
            Tree OS identity
            <span className="h-px w-8 bg-purple-400/40" />
          </div>
          <p className="mb-2 text-base font-semibold text-neutral-400">
            Your project is not a folder.
          </p>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            It is a{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(110deg, #34d399 0%, #a855f7 50%, #30e7ff 100%)",
              }}
            >
              living system.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            LiTTree visualizes your workspace as a growing intelligence network.
            Every mission grows the tree. Every approved result becomes part of the system.
          </p>
        </div>

        {/* Node cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-16">
          {NODES.map((n) => (
            <div
              key={n.concept}
              className="group relative overflow-hidden rounded-2xl border border-white/8 p-6 transition-all duration-300 hover:border-white/15"
              style={{
                background:
                  "linear-gradient(145deg, rgba(255,255,255,0.025), transparent)",
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{
                  background: `radial-gradient(circle at 30% 30%, ${n.color}12, transparent 60%)`,
                }}
              />
              <div className="relative">
                <div className="mb-3 text-3xl">{n.symbol}</div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-base font-black text-white">{n.concept}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
                    style={{
                      color: n.color,
                      background: `${n.color}15`,
                      border: `1px solid ${n.color}30`,
                    }}
                  >
                    {n.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-neutral-400">{n.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Example creator stats strip */}
        <div
          className="overflow-hidden rounded-2xl border border-white/8 px-8 py-6"
          style={{
            background:
              "linear-gradient(145deg, rgba(168,85,247,0.05), rgba(48,231,255,0.03)), rgba(255,255,255,0.01)",
          }}
        >
          <div className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600">
            Example creator profile
          </div>
          <div className="flex flex-wrap items-center justify-center gap-0">
            {STATS.map((s, i) => (
              <div key={s.label} className="flex items-center">
                {i > 0 && (
                  <div className="mx-6 h-8 w-px bg-white/6 hidden sm:block" />
                )}
                <div className="px-4 text-center">
                  <div
                    className="text-xl font-black"
                    style={{ color: s.color }}
                  >
                    {s.value}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
