/**
 * LandingProductCards — the core product surfaces.
 *
 * V1 spec: Code, Studio, Terminal, Tests, Deploy, Memory, Games.
 * Each card is labeled truthfully with its V1 status (LIVE / BETA / COMING).
 */

import { Code2, LayoutDashboard, TerminalSquare, CheckCircle, Rocket, Brain, Gamepad2, type LucideIcon } from "lucide-react";

type Status = "LIVE" | "BETA" | "COMING";

const CARDS: Array<{
  icon: LucideIcon;
  title: string;
  desc: string;
  status: Status;
  color: string;
}> = [
  {
    icon: Code2,
    title: "Code",
    desc: "Read, search, and edit real project files. LiTT writes actual code into your connected workspace.",
    status: "LIVE",
    color: "#a855f7",
  },
  {
    icon: LayoutDashboard,
    title: "Studio",
    desc: "Prompt ↔ Canvas ↔ Code ↔ Preview ↔ Files. One workspace where the idea becomes a working app.",
    status: "BETA",
    color: "#30e7ff",
  },
  {
    icon: TerminalSquare,
    title: "Terminal",
    desc: "Run commands through a hardened executor. Real processes, real exit codes, real cancellation.",
    status: "LIVE",
    color: "#f97316",
  },
  {
    icon: CheckCircle,
    title: "Tests",
    desc: "Typecheck, test, and build run through the VerificationGate. COMPLETE means the runtime proved it passed.",
    status: "LIVE",
    color: "#34d399",
  },
  {
    icon: Rocket,
    title: "Deploy",
    desc: "Review the diff, approve, and ship. Vercel + GitHub PRs. Human approval before any production deploy.",
    status: "BETA",
    color: "#818cf8",
  },
  {
    icon: Brain,
    title: "Memory",
    desc: "LiTT remembers your project — decisions, structure, approved outcomes. Come back later and pick up where you left off.",
    status: "BETA",
    color: "#ec4899",
  },
  {
    icon: Gamepad2,
    title: "Games",
    desc: "Build playable games with LiTT. Real code, real assets, real shipping — the same pipeline as any app.",
    status: "COMING",
    color: "#f59e0b",
  },
];

const STATUS_STYLES: Record<Status, { color: string; bg: string; border: string }> = {
  LIVE: { color: "#34d399", bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)" },
  BETA: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" },
  COMING: { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" },
};

export function LandingProductCards() {
  return (
    <section id="product" className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
            <span className="h-px w-8 bg-violet-400/40" />
            The product
            <span className="h-px w-8 bg-violet-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            One workspace.
            <br />
            <span className="bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
              Every part of the build.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            Not a chat wrapper. A full production environment where LiTT works inside your
            actual project, in real time, with your approval at every critical step.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ icon: Icon, title, desc, status, color }) => {
            const s = STATUS_STYLES[status];
            return (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/8 p-6 transition-all duration-500 hover:-translate-y-1 hover:border-white/15 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
                style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.02), transparent)" }}
              >
                <div
                  className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
                  style={{ background: color }}
                />
                {/* Colored border glow on hover */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  style={{ boxShadow: `inset 0 0 0 1px ${color}30` }}
                />
                <div className="relative">
                  <div className="mb-4 flex items-center justify-between">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl shadow-lg"
                      style={{ background: `${color}22`, border: `1px solid ${color}30` }}
                    >
                      <Icon size={18} style={{ color }} />
                    </div>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
                      style={{ color: s.color, borderColor: s.border, background: s.bg }}
                    >
                      {status}
                    </span>
                  </div>
                  <h3 className="mb-1.5 text-sm font-black tracking-tight text-white">{title}</h3>
                  <p className="text-xs leading-relaxed text-neutral-500">{desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
