import {
  GitBranch,
  Zap,
  Cloud,
  Shield,
  Cpu,
  TrendingUp,
} from "lucide-react";

const LOGOS = [
  { name: "GitHub", icon: GitBranch },
  { name: "Vercel", icon: Zap },
  { name: "Supabase", icon: Cloud },
  { name: "Clerk", icon: Shield },
  { name: "OpenAI", icon: Cpu },
  { name: "Stripe", icon: TrendingUp },
];

export function LandingLogos() {
  return (
    <section className="relative z-10 border-y border-white/5 bg-white/[0.01] px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
          Connects to the stack you already use
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {LOGOS.map(({ name, icon: Icon }) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-neutral-300 transition hover:border-white/15 hover:bg-white/[0.04]"
            >
              <Icon size={14} className="text-cyan-300" />
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
