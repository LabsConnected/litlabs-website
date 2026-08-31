import Link from "next/link";
import {
  ArrowUpRight,
  BrainCircuit,
  FileCode2,
  GitBranch,
  Palette,
  ShieldCheck,
} from "lucide-react";

const LIVE_CAPABILITIES = [
  { label: "Real project files", icon: FileCode2 },
  { label: "Persistent memory", icon: BrainCircuit },
  { label: "Human approvals", icon: ShieldCheck },
  { label: "GitHub connection", icon: GitBranch },
  { label: "Creative tools", icon: Palette },
] as const;

export function CapabilityStatus() {
  return (
    <section aria-label="LiTTree capability availability" className="relative border-y border-white/8 bg-[#05070d] px-5 py-5 lg:px-8">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex shrink-0 items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#a8ff2f] opacity-45" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#a8ff2f] shadow-[0_0_14px_rgba(168,255,47,.7)]" />
          </span>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#a8ff2f]">Working now</div>
            <div className="mt-0.5 text-xs font-semibold text-white/42">Core capabilities available in Studio</div>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap gap-2 xl:justify-center">
          {LIVE_CAPABILITIES.map(({ label, icon: Icon }) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/3 px-3 py-2 text-[11px] font-bold text-white/58">
              <Icon size={12} className="text-[#65f4ff]" /> {label}
            </span>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-[10px] font-black uppercase tracking-[0.14em]">
          <span className="rounded-full border border-amber-300/16 bg-amber-300/6 px-3 py-2 text-amber-200/78">Voice · Terminal · Deploy <span className="text-white/30">Beta</span></span>
          <Link href="/pricing" className="hidden items-center gap-1.5 text-white/40 transition hover:text-white sm:inline-flex">
            Compare plans <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
