import {
  GitBranch,
  Zap,
  Cloud,
  Shield,
  Cpu,
  TrendingUp,
  Database,
  Globe,
  Box,
  Layers,
  Workflow,
} from "lucide-react";

const LOGOS = [
  { name: "GitHub", icon: GitBranch, color: "text-neutral-300" },
  { name: "Vercel", icon: Zap, color: "text-white" },
  { name: "Supabase", icon: Database, color: "text-emerald-400" },
  { name: "Clerk", icon: Shield, color: "text-violet-400" },
  { name: "OpenAI", icon: Cpu, color: "text-cyan-300" },
  { name: "Stripe", icon: TrendingUp, color: "text-indigo-400" },
  { name: "Cloudflare", icon: Cloud, color: "text-amber-400" },
  { name: "Fal.ai", icon: Box, color: "text-pink-400" },
  { name: "OpenRouter", icon: Workflow, color: "text-fuchsia-400" },
  { name: "Netlify", icon: Globe, color: "text-teal-400" },
  { name: "Docker", icon: Layers, color: "text-sky-400" },
];

const DOUBLED = [...LOGOS, ...LOGOS];

export function LandingLogos() {
  return (
    <section className="relative z-10 border-y border-white/5 bg-white/1 py-10 overflow-hidden">
      <div className="mb-6 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
        Connects to the stack you already use
      </div>

      {/* Marquee track */}
      <div className="relative">
        {/* Edge fade masks */}
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-24 bg-linear-to-r from-[#06060e] to-transparent" />
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-24 bg-linear-to-l from-[#06060e] to-transparent" />

        <div
          className="flex gap-3"
          style={{
            animation: "marquee 28s linear infinite",
            width: "max-content",
          }}
        >
          {DOUBLED.map(({ name, icon: Icon, color }, i) => (
            <div
              key={`${name}-${i}`}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-white/8 bg-white/2 px-4 py-2.5 text-sm font-semibold text-neutral-300"
            >
              <Icon size={14} className={color} />
              {name}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
