/**
 * LandingTrust — trust signals (V1).
 *
 * V1 spec:
 *   - Your work stays yours
 *   - BYOK
 *   - Human approval
 *   - Real files
 *   - Real execution
 *   - Checkpoints / safety
 */

import { ShieldCheck, KeyRound, UserCheck, FileCode2, Cpu, GitBranch } from "lucide-react";

const TRUST = [
  {
    icon: ShieldCheck,
    title: "Your work stays yours",
    desc: "LiTT edits your real repo. You own the code, the files, the commits, and the IP. We never train on your private projects.",
    color: "#34d399",
  },
  {
    icon: KeyRound,
    title: "Bring your own keys",
    desc: "Use your own OpenRouter, OpenAI, or Anthropic keys. Your model spend stays with your provider — LiTT never marks up your tokens.",
    color: "#30e7ff",
  },
  {
    icon: UserCheck,
    title: "Human approval",
    desc: "Dangerous and production-affecting actions require your explicit approval. Nothing ships without you saying yes.",
    color: "#f59e0b",
  },
  {
    icon: FileCode2,
    title: "Real files",
    desc: "LiTT reads, searches, and edits the actual files in your connected workspace. You see every change as a real diff.",
    color: "#a855f7",
  },
  {
    icon: Cpu,
    title: "Real execution",
    desc: "Typecheck, tests, and build run through a hardened executor with real exit codes. COMPLETE means the runtime proved it passed.",
    color: "#ec4899",
  },
  {
    icon: GitBranch,
    title: "Checkpoints & safety",
    desc: "Every action is auditable. Git diff before commit. Cancel any run. Process-tree kill leaves zero orphans. Recoverable beats gone.",
    color: "#818cf8",
  },
];

export function LandingTrust() {
  return (
    <section className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-px w-8 bg-emerald-400/40" />
            Trust & safety
            <span className="h-px w-8 bg-emerald-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            Built for real work.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-violet-300 bg-clip-text text-transparent">
              Not for taking your code.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            LiTT is a tool you control. Your files, your keys, your approval, your repo.
            We earn trust by being transparent — not by locking you in.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map(({ icon: Icon, title, desc, color }) => (
            <div
              key={title}
              className="group rounded-2xl border border-white/8 p-6 transition-all duration-500 hover:-translate-y-1 hover:border-white/15 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
              style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.02), transparent)" }}
            >
              <div
                className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: `${color}18`, border: `1px solid ${color}30` }}
              >
                <Icon size={18} style={{ color }} />
              </div>
              <h3 className="mb-1.5 text-sm font-black tracking-tight text-white">{title}</h3>
              <p className="text-xs leading-relaxed text-neutral-500">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
