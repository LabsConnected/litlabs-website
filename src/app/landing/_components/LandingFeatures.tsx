import {
  Bot,
  Layers,
  Terminal,
  Image as ImageIcon,
  Workflow,
  Briefcase,
  MessageSquare,
  BarChart3,
  Brain,
  type LucideIcon,
} from "lucide-react";

const FEATURES: Array<{
  icon: LucideIcon;
  title: string;
  desc: string;
  accent: string;
}> = [
  {
    icon: Bot,
    title: "AI Agent Crew",
    desc: "Direct a team of specialized agents that plan, write, design, and ship — together.",
    accent: "from-cyan-400 to-blue-500",
  },
  {
    icon: Layers,
    title: "Visual Builder",
    desc: "Drag, drop, and compose interfaces, pipelines, and content without losing control.",
    accent: "from-fuchsia-400 to-pink-500",
  },
  {
    icon: Terminal,
    title: "Smart Terminal",
    desc: "Cloud IDE with AI assistance, live preview, and one-click deploy to Vercel.",
    accent: "from-amber-400 to-orange-500",
  },
  {
    icon: ImageIcon,
    title: "Generative Studio",
    desc: "Image, video, audio, and code generation in a single creative canvas.",
    accent: "from-violet-400 to-purple-500",
  },
  {
    icon: Workflow,
    title: "Pipeline Engine",
    desc: "Chain agents into repeatable workflows that turn ideas into shipped artifacts.",
    accent: "from-emerald-400 to-teal-500",
  },
  {
    icon: Briefcase,
    title: "Marketplace",
    desc: "Publish agents, templates, and projects — and earn LBC for every install.",
    accent: "from-rose-400 to-red-500",
  },
  {
    icon: MessageSquare,
    title: "Live Collaboration",
    desc: "Co-build with your crew in real time. Comments, reviews, and approvals in one place.",
    accent: "from-sky-400 to-indigo-500",
  },
  {
    icon: BarChart3,
    title: "Creator Analytics",
    desc: "Track usage, latency, and earnings across every project and agent you operate.",
    accent: "from-yellow-400 to-amber-500",
  },
  {
    icon: Brain,
    title: "Memory That Lasts",
    desc: "Persistent context across sessions. Your agents remember your style, stack, and goals.",
    accent: "from-pink-400 to-fuchsia-500",
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="relative z-10 px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
            <span className="h-px w-8 bg-cyan-400/40" />
            Capabilities
            <span className="h-px w-8 bg-cyan-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            Everything you need to ship.
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-amber-300 bg-clip-text text-transparent">
              In one workspace.
            </span>
          </h2>
          <p className="mx-auto max-w-2xl text-base text-neutral-400">
            Nine pillars. One platform. The agent crew, the visual tools, the
            runtime, the marketplace — finally together.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc, accent }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] p-6 transition hover:border-white/15 hover:bg-white/[0.04]"
            >
              <div
                className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${accent} opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30`}
              />

              <div className="relative">
                <div
                  className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${accent} shadow-lg`}
                >
                  <Icon size={20} className="text-black" />
                </div>

                <h3 className="mb-2 text-base font-black tracking-tight text-white">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-neutral-400">
                  {desc}
                </p>

                <div className="mt-5 flex items-center gap-1.5 text-xs font-bold text-neutral-300 opacity-0 transition group-hover:opacity-100">
                  Learn more
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
