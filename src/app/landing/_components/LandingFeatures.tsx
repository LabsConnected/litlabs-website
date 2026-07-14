import {
  Bot,
  Layers,
  Terminal,
  Image as ImageIcon,
  Brain,
  Rocket,
  Mic,
  GitBranch,
  type LucideIcon,
} from "lucide-react";

const FEATURES: Array<{
  icon: LucideIcon;
  title: string;
  desc: string;
  bullets: string[];
  color: string;
}> = [
  {
    icon: Bot,
    title: "AI Project Director",
    desc: "Run complex missions through one conversational command center.",
    bullets: ["Mission planning", "Agent assignment", "Approval checkpoints", "Failure recovery"],
    color: "#a855f7",
  },
  {
    icon: Layers,
    title: "Multi-Agent Crew",
    desc: "Specialized agents instead of one overloaded assistant.",
    bullets: ["Engineering (Forge)", "Design (Visionary)", "Research Beast", "QA Goblin"],
    color: "#30e7ff",
  },
  {
    icon: Terminal,
    title: "Live Builder Canvas",
    desc: "See the work while it happens.",
    bullets: ["Application preview", "Code editor", "File explorer", "Responsive views"],
    color: "#f97316",
  },
  {
    icon: GitBranch,
    title: "Real Project Changes",
    desc: "LiTT works against actual project files.",
    bullets: ["File creation & edits", "Diff review", "Branch support", "Pull request prep"],
    color: "#34d399",
  },
  {
    icon: Mic,
    title: "Voice & Holo Mode",
    desc: "Talk naturally without leaving Studio.",
    bullets: ["Live voice conversations", "Spoken agent responses", "Camera-assisted context", "Inline voice controls"],
    color: "#f472b6",
  },
  {
    icon: ImageIcon,
    title: "Visual Creation",
    desc: "Create production-ready visual assets inside the same mission.",
    bullets: ["Images & brand assets", "Interface concepts", "Social graphics", "Product mockups"],
    color: "#f59e0b",
  },
  {
    icon: Brain,
    title: "Project Memory",
    desc: "LiTT remembers decisions, preferences, and approved outcomes.",
    bullets: ["Persistent across sessions", "Per-project context", "Approved outcome history", "Zero restart friction"],
    color: "#ec4899",
  },
  {
    icon: Rocket,
    title: "Deployment Control",
    desc: "Connect the stack you already use.",
    bullets: ["Vercel deployments", "GitHub PRs", "Supabase projects", "Build logs & previews"],
    color: "#818cf8",
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="relative z-10 px-4 py-16 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
            <span className="h-px w-8 bg-cyan-400/40" />
            Studio capabilities
            <span className="h-px w-8 bg-cyan-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            One workspace.
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-purple-300 to-orange-300 bg-clip-text text-transparent">
              Every part of the build.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            Not a chat wrapper. A full production environment where agents work inside your
            actual project, in real time, with your approval at every critical step.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, desc, bullets, color }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-white/8 p-6 transition-all duration-300 hover:border-white/15"
              style={{
                background: "linear-gradient(145deg, rgba(255,255,255,0.02), transparent)",
              }}
            >
              <div
                className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
                style={{ background: color }}
              />

              <div className="relative">
                <div
                  className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl shadow-lg"
                  style={{ background: `${color}22`, border: `1px solid ${color}30` }}
                >
                  <Icon size={18} style={{ color }} />
                </div>

                <h3 className="mb-1.5 text-sm font-black tracking-tight text-white">
                  {title}
                </h3>
                <p className="mb-3 text-xs leading-relaxed text-neutral-500">{desc}</p>

                <ul className="space-y-1">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                      <span className="h-1 w-1 rounded-full shrink-0" style={{ background: color }} />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
