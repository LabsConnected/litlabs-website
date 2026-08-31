import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Bot,
  Boxes,
  Check,
  Terminal,
  Wrench,
} from "lucide-react";

const OPERATING_LOOP = [
  "Understand",
  "Plan",
  "Build",
  "Create",
  "Use tools",
  "Verify",
  "Ship",
] as const;

const TOOL_CHIPS = [
  "Plan",
  "Code",
  "Files",
  "Terminal",
  "Git",
  "Test",
  "Deploy",
] as const;

export function AgentCrew() {
  return (
    <section id="operator" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#070912]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_45%,rgba(168,255,47,.07),transparent_28%),radial-gradient(circle_at_85%_42%,rgba(181,140,255,.09),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow"><Bot size={13} /> LiTT — your project operator</div>
          <h2 className="mt-5 text-[clamp(2.3rem,5vw,4.8rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            One operator. <span className="litt-gradient-text">The whole project loop.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            LiTT coordinates every stage of the work — understanding the brief, planning the mission, building, creating, using tools, verifying, and shipping. You stay in charge of the outcome.
          </p>
        </div>

        <article data-reveal className="litt-agent-card litt-agent-litt group mt-12">
          <Image
            src="/brand/litt-agent-hero-v2.png"
            alt="LiTT, the primary AI operator"
            fill
            sizes="(max-width: 1024px) 92vw, 88vw"
            className="object-cover object-[56%_48%] transition duration-700 group-hover:scale-[1.035]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,10,.94),rgba(3,5,10,.7)_42%,rgba(3,5,10,.12)),linear-gradient(0deg,rgba(3,5,10,.9),transparent_52%)]" />
          <div className="relative z-10 flex min-h-[520px] max-w-2xl flex-col p-6 sm:p-8 lg:min-h-[590px]">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/22 bg-[#a8ff2f]/8 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#caff85]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f] shadow-[0_0_9px_#a8ff2f]" /> Online · operator
              </span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/36">Operator / 01</span>
            </div>

            <div className="mt-auto rounded-2xl border border-white/12 bg-[#05070d]/78 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#a8ff2f]/24 bg-[#a8ff2f]/10 text-[#a8ff2f]"><Bot size={21} /></span>
                <div><h3 className="text-2xl font-black text-white">LiTT</h3><p className="text-[10px] font-black uppercase tracking-[0.17em] text-[#a8ff2f]">Control plane + builder</p></div>
              </div>
              <p className="mt-4 text-sm leading-6 text-white/58">Understands the brief, forms a mission, plans the work, writes code, edits files, runs terminal and git, calls tools, tests changes, manages approvals, and prepares deployment.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {TOOL_CHIPS.map((skill, index) => (
                  <span key={skill} className="litt-tool-chip inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[10px] font-bold text-white/48" style={{ "--chip-index": index } as CSSProperties}>
                    <Wrench size={10} className="text-white/35" /> {skill}
                  </span>
                ))}
              </div>
              <Link href="/agents/litt" className="mt-5 inline-flex items-center gap-2 text-xs font-black text-white/74 transition hover:text-[#a8ff2f]">Meet LiTT <ArrowRight size={13} /></Link>
            </div>
          </div>
        </article>

        <div data-reveal className="mt-5 grid gap-5 rounded-2xl border border-white/9 bg-white/[0.025] p-5 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:p-7">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-white/48"><Boxes size={14} className="text-[#65f4ff]" /> One project. One operating loop.</div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {OPERATING_LOOP.map((step, index) => (
                <div key={step} className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#05070d] px-3 py-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/5 font-mono text-[9px] font-black text-[#a8ff2f]">0{index + 1}</span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/58">
                    {index === OPERATING_LOOP.length - 1 ? <Check size={11} className="text-[#a8ff2f]" /> : <Terminal size={10} className="text-white/40" />}
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <p className="max-w-md text-sm leading-6 text-white/45 lg:text-right">Bring internal specialists or Marketplace agents into the loop when a mission needs more depth.</p>
            <Link href="/agents" className="litt-secondary-button !min-h-11 !px-4 !py-2.5 text-xs">See the operator stack <ArrowRight size={13} /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
