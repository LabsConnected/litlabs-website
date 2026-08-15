/**
 * LandingRoadmap — truthful V1 roadmap.
 *
 * V1 spec: label truthfully as LIVE / BETA / COMING.
 * Do NOT pretend future features are live.
 */

type RoadmapStatus = "LIVE" | "BETA" | "COMING";

const ROADMAP: Array<{
  status: RoadmapStatus;
  title: string;
  desc: string;
}> = [
  { status: "LIVE", title: "Code read / search / edit", desc: "Read, search, and edit real project files through the hardened executor." },
  { status: "LIVE", title: "Terminal execution", desc: "Run commands with real exit codes, cancellation, and process-tree kill." },
  { status: "LIVE", title: "VerificationGate", desc: "Typecheck + test + build + browser checks. COMPLETE = runtime proved it passed." },
  { status: "LIVE", title: "Git diff / status", desc: "See exactly what changed before anything ships." },
  { status: "LIVE", title: "Approval before dangerous actions", desc: "Human approval gate for destructive or production-affecting operations." },
  { status: "LIVE", title: "CLI cockpit", desc: "The LiTT terminal cockpit — connected to the same runtime as Studio." },
  { status: "BETA", title: "Studio (web workspace)", desc: "Prompt ↔ Canvas ↔ Code ↔ Preview ↔ Files in the browser." },
  { status: "BETA", title: "Project memory", desc: "LiTT remembers your project across sessions." },
  { status: "BETA", title: "Deploy to Vercel + GitHub PRs", desc: "Review, approve, and ship from inside the mission." },
  { status: "BETA", title: "LiTBits accounting", desc: "Pay for what you use. Free entry, low-cost LiTBits, BYOK." },
  { status: "BETA", title: "Model selection / BYOK", desc: "Bring your own OpenRouter key. Route to fast / smart / long profiles." },
  { status: "COMING", title: "Games pipeline", desc: "Build, verify, and ship playable browser games end-to-end." },
  { status: "COMING", title: "Multi-agent crews", desc: "Specialized agents (Forge, Visionary, Research, QA) on one mission." },
  { status: "COMING", title: "Voice mode", desc: "Talk to LiTT. Spoken responses, camera-assisted context." },
  { status: "COMING", title: "Cloud handoff", desc: "Run long missions in the cloud and pick them up anywhere." },
  { status: "COMING", title: "Marketplace", desc: "Share and install LiTT plugins, tools, and project templates." },
];

const STATUS_STYLES: Record<RoadmapStatus, { color: string; bg: string; border: string }> = {
  LIVE: { color: "#34d399", bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)" },
  BETA: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" },
  COMING: { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" },
};

export function LandingRoadmap() {
  return (
    <section id="roadmap" className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-px w-8 bg-emerald-400/40" />
            Roadmap
            <span className="h-px w-8 bg-emerald-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            What&apos;s real today.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-amber-300 to-slate-300 bg-clip-text text-transparent">
              What&apos;s coming next.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            We don&apos;t pretend future features are live. Here is exactly what works now,
            what is in beta, and what is on the way.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {ROADMAP.map((item) => {
            const s = STATUS_STYLES[item.status];
            return (
              <div
                key={item.title}
                className="flex items-start gap-4 rounded-xl border border-white/8 bg-white/2 p-4 transition-all duration-500 hover:border-white/12 hover:bg-white/3"
              >
                <span
                  className="mt-0.5 shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest"
                  style={{ color: s.color, borderColor: s.border, background: s.bg }}
                >
                  {item.status}
                </span>
                <div>
                  <div className="text-sm font-bold text-white">{item.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">{item.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
