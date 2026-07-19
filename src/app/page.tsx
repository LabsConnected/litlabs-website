"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Code2,
  Command,
  Layers3,
  Play,
  Radio,
  Rocket,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import { useClerkAuth } from "@/hooks/useClerkAuth";

const agents = [
  { icon: Code2, name: "LiTT-Code", role: "Engineer & Architect", copy: "Builds, reviews, and hardens production software. Writes clean TypeScript, designs APIs, and ships fast.", color: "#22d3ee" },
  { icon: Command, name: "LiTTle-Bit", role: "Director & Operations", copy: "Routes the mission, holds the context, and keeps every specialist moving together. Plans, researches, and reviews.", color: "#f97316" },
];

const steps = [
  ["01", "Pick your crew", "Start with a specialist or let LiTT-Code assemble the right team for the mission."],
  ["02", "Connect the work", "Bring prompts, tools, media, and automations together in one visual workspace."],
  ["03", "Ship the result", "Review the output, publish it, or turn it into a reusable workflow for next time."],
];

function AgentConsole() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-16 rounded-full bg-violet-500/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#141610] p-4 shadow-2xl shadow-black/60 sm:p-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          <span className="flex items-center gap-2"><Sparkles size={13} className="text-[#c8ff3d]" /> Mission control</span>
          <span className="flex items-center gap-2 text-[#c8ff3d]"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8ff3d]" /> Live</span>
        </div>
        <div className="flex items-center gap-3 py-6">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#7657ff] text-white"><Rocket size={19} /></span>
          <div className="min-w-0 flex-1"><span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">Active mission</span><strong className="mt-1 block truncate text-sm text-white">Launch the Signal campaign</strong></div>
          <b className="font-mono text-xs text-[#c8ff3d]">72%</b>
        </div>
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/10"><i className="block h-full w-[72%] rounded-full bg-[#c8ff3d]" /></div>
        {[
          ["CD", "Visionary", "Campaign system complete", "Done", "#c8ff3d"],
          ["FG", "Forge", "Building landing experience", "Working", "#6ee7f9"],
          ["PL", "Pulse", "12 launch posts queued", "Ready", "#9f8cff"],
        ].map(([initials, name, task, state, color]) => (
          <div key={name} className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg text-[9px] font-black text-[#10110d]" style={{ backgroundColor: color }}>{initials}</span>
            <div className="min-w-0 flex-1"><strong className="block text-xs text-white">{name}</strong><small className="mt-1 block truncate text-[10px] text-white/40">{task}</small></div>
            <span className="font-mono text-[9px] text-white/35">{state}</span>
          </div>
        ))}
        <div className="mt-5 flex h-12 items-center gap-3 rounded-xl border border-white/10 px-4 font-mono text-[10px] text-white/30"><Zap size={14} className="text-[#c8ff3d]" /><span className="flex-1">Give your crew a new mission…</span><span>↵</span></div>
      </div>
      <div className="absolute -bottom-7 -left-4 hidden items-center gap-3 rounded-xl border border-black bg-[#f5f2e9] px-4 py-3 text-[#12130f] shadow-[5px_5px_0_#111] sm:flex">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#c8ff3d]"><Check size={14} strokeWidth={3} /></span>
        <div><strong className="block text-[10px]">Landing page shipped</strong><small className="text-[9px] opacity-50">Forge · just now</small></div>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="relative overflow-hidden bg-[#f4f1e8] text-[#11120f]">
      <section className="relative px-4 pb-24 pt-20 sm:px-6 md:pb-32 md:pt-28">
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(rgba(17,18,15,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(17,18,15,.06) 1px,transparent 1px)", backgroundSize: "70px 70px" }} />
        <div className="relative mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white/50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em]"><i className="h-2 w-2 rounded-full bg-[#c8ff3d] ring-4 ring-[#c8ff3d]/20" /> Public beta is live</div>
            <h1 className="mt-8 max-w-3xl text-[clamp(4.3rem,8vw,7.6rem)] font-black leading-[0.82] tracking-[-0.075em]">Your AI crew.<br /><span className="font-serif font-normal italic text-[#7559ff]">Always building.</span></h1>
            <p className="mt-8 max-w-xl text-base leading-8 text-black/60 sm:text-lg">LiTTree brings specialized agents, creative tools, and automated workflows into one connected workspace—so a small team can move like a studio.</p>
            <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <Link href="/sign-up" className="group inline-flex min-h-14 items-center gap-8 rounded-lg border border-black bg-[#c8ff3d] px-6 text-sm font-black shadow-[5px_5px_0_#111] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_#111]">Build your first agent <ArrowRight size={16} className="transition group-hover:translate-x-1" /></Link>
              <Link href="/studio" className="inline-flex items-center gap-3 border-b border-black py-2 text-sm font-bold"><Play size={14} fill="currentColor" /> See it in action</Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-7 gap-y-2 text-[11px] font-bold text-black/50"><span className="flex items-center gap-2"><Check size={13} /> Start free</span><span className="flex items-center gap-2"><Check size={13} /> No credit card</span><span className="flex items-center gap-2"><Check size={13} /> Your data stays yours</span></div>
          </div>
          <AgentConsole />
        </div>
      </section>

      <section className="border-y border-black/10 bg-[#ece9df] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between"><p className="m-0 font-serif text-base italic text-black/50">One workspace. An unfair amount of momentum.</p><div className="grid grid-cols-2 gap-x-8 gap-y-4 text-[10px] font-black uppercase tracking-[0.16em] text-black/45 sm:flex sm:gap-10"><span>Agents</span><span>Studio</span><span>Automations</span><span>Marketplace</span></div></div>
      </section>

      <section className="px-4 py-24 sm:px-6 md:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-end"><div><span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7559ff]">The platform</span><h2 className="mt-5 text-5xl font-black leading-[0.92] tracking-[-0.06em] sm:text-7xl">From idea to impact,<br />without the busywork.</h2></div><p className="max-w-lg text-sm leading-7 text-black/55 lg:justify-self-end">Every part of your process gets an intelligent co-pilot—connected, coordinated, and ready to move from a clear mission to finished work.</p></div>
          <div className="mt-16 grid gap-4 lg:grid-cols-2">
            <article className="relative min-h-[560px] overflow-hidden rounded-2xl border border-black bg-[#dfe6d9] p-8 sm:p-11 lg:row-span-2 lg:min-h-[760px]"><span className="font-mono text-[9px] font-bold tracking-[0.16em]">01 / ORCHESTRATE</span><h3 className="mt-20 max-w-xl text-4xl font-black leading-[1] tracking-[-0.055em] sm:text-5xl">Give the mission.<br />Your crew handles the rest.</h3><p className="mt-6 max-w-md text-sm leading-7 text-black/55">Coordinate multiple specialists from one command center. Set the outcome, review the work, and stay in control of every decision.</p><div className="absolute bottom-10 left-8 right-8 flex items-center justify-between border-y border-black/15 py-10 font-mono text-[9px] font-bold tracking-widest sm:left-11 sm:right-11"><span>YOUR IDEA</span><span className="grid h-20 w-20 place-items-center rounded-full bg-[#c8ff3d] text-2xl shadow-[0_0_0_16px_rgba(200,255,61,.22)]">✦</span><span>SHIPPED</span></div></article>
            <article className="relative min-h-[370px] overflow-hidden rounded-2xl border border-black bg-[#151610] p-8 text-white"><span className="font-mono text-[9px] font-bold tracking-[0.16em] text-white/45">02 / CREATE</span><h3 className="mt-14 text-3xl font-black leading-[1.05] tracking-[-0.05em]">Every creative tool.<br />One fluid workspace.</h3><p className="mt-5 max-w-md text-sm leading-7 text-white/45">Generate images, audio, code, copy, and workflows without breaking your flow.</p><div className="absolute bottom-7 left-8 flex flex-wrap gap-2">{["IMAGE","AUDIO","CODE","WORDS","FLOW"].map(t=><span key={t} className="rounded-full border border-white/15 px-3 py-2 font-mono text-[8px] text-white/55">{t}</span>)}</div></article>
            <article className="relative min-h-[370px] overflow-hidden rounded-2xl border border-[#7559ff] bg-[#7559ff] p-8 text-white"><span className="font-mono text-[9px] font-bold tracking-[0.16em] text-white/60">03 / CONNECT</span><h3 className="mt-14 text-3xl font-black leading-[1.05] tracking-[-0.05em]">Built around the tools<br />you already use.</h3><p className="mt-5 max-w-md text-sm leading-7 text-white/65">Turn scattered tasks into one visible, reliable system.</p><div className="absolute bottom-7 right-7 flex">{[Workflow,Layers3,Radio,Bot].map((Icon,i)=><span key={i} className="-ml-2 grid h-12 w-12 place-items-center rounded-full border-4 border-[#7559ff] bg-[#f4f1e8] text-[#11120f]"><Icon size={16}/></span>)}</div></article>
          </div>
        </div>
      </section>

      <section className="bg-[#151610] px-4 py-24 text-white sm:px-6 md:py-32">
        <div className="mx-auto max-w-7xl"><div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end"><div><span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c8ff3d]">Meet the crew</span><h2 className="mt-5 text-5xl font-black leading-[0.92] tracking-[-0.06em] sm:text-7xl">Specialists who never<br />lose the thread.</h2></div><Link href="/agents" className="inline-flex w-fit items-center gap-4 border-b border-white/50 py-2 text-sm font-bold">Explore all agents <ArrowRight size={15}/></Link></div>
          <div className="mt-16 grid gap-4 md:grid-cols-3">{agents.map((agent,index)=>{const Icon=agent.icon;return <article key={agent.name} className="group rounded-2xl border border-white/10 bg-white/[0.025] p-7 transition hover:-translate-y-1 hover:border-white/25"><div className="flex items-center justify-between font-mono text-[9px] text-white/35"><span>0{index+1}</span><span>{agent.role.toUpperCase()}</span></div><div className="mx-auto my-14 grid h-28 w-28 place-items-center rounded-full text-[#11120f] shadow-[0_0_70px_rgba(200,255,61,.12)]" style={{background:`radial-gradient(circle at 35% 30%,white,${agent.color} 65%)`}}><Icon size={31}/></div><h3 className="text-2xl font-black tracking-[-0.04em]">{agent.name}</h3><p className="mt-3 min-h-16 text-sm leading-6 text-white/45">{agent.copy}</p><Link href="/agents" className="mt-7 flex items-center justify-between border-t border-white/10 pt-5 text-xs font-bold text-[#c8ff3d]">Meet this agent <ArrowRight size={14}/></Link></article>})}</div>
        </div>
      </section>

      <section className="px-4 py-24 sm:px-6 md:py-32"><div className="mx-auto max-w-7xl"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7559ff]">How it works</span><h2 className="mt-5 text-5xl font-black leading-[0.92] tracking-[-0.06em] sm:text-7xl">A bigger team<br />in three small steps.</h2><div className="mt-16 grid gap-10 md:grid-cols-3">{steps.map(([no,title,copy])=><article key={no} className="border-t border-black pt-6"><span className="font-mono text-[10px] font-bold text-[#7559ff]">{no}</span><h3 className="mt-14 text-2xl font-black tracking-[-0.04em]">{title}</h3><p className="mt-4 text-sm leading-7 text-black/55">{copy}</p></article>)}</div></div></section>

      <section className="px-4 pb-24 sm:px-6 md:pb-32"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-12 overflow-hidden rounded-2xl border border-black bg-[#c8ff3d] p-8 shadow-[8px_8px_0_#111] sm:p-14 lg:flex-row lg:items-center"><div><span className="text-[10px] font-black uppercase tracking-[0.2em]">Ready when you are</span><h2 className="mt-6 text-5xl font-black leading-[0.88] tracking-[-0.07em] sm:text-7xl">Build what’s next.<br /><span className="font-serif font-normal italic">Bring your crew.</span></h2><p className="mt-6 text-sm text-black/60">Your first agent is free. No setup maze, no credit card, no waiting.</p><Link href="/sign-up" className="mt-8 inline-flex min-h-14 items-center gap-8 rounded-lg bg-black px-6 text-sm font-black text-white">Start building for free <ArrowRight size={16}/></Link></div><div className="hidden text-[13rem] font-black leading-none tracking-[-0.18em] lg:block">L<span className="text-5xl text-[#7559ff]">✦</span></div></div></section>
    </div>
  );
}

export default function HomePage() {
  const { isSignedIn: supabaseSignedIn } = useSupabaseAuthHook();
  const { isSignedIn: clerkSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (supabaseSignedIn || clerkSignedIn) router.replace("/dashboard");
  }, [supabaseSignedIn, clerkSignedIn, router]);

  return <LandingPage />;
}
