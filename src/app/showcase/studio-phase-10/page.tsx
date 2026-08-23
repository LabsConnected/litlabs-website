"use client";

import Image from "next/image";
import { useState } from "react";
import { Activity, ArrowUp, Bot, Check, ChevronDown, CircleCheck, Code2, Eye, FileCode2, Files, GitBranch, GitCommit, Home, ImageIcon, LayoutDashboard, MessageSquare, MoreHorizontal, Paperclip, Play, Search, Settings, ShieldCheck, Sparkles, TerminalSquare } from "lucide-react";

type WorkspaceView = "plan" | "code" | "preview" | "review";
type InspectorView = "plan" | "changes" | "checks" | "review";

const NAV = [
  { label: "Home", icon: Home }, { label: "Studio", icon: LayoutDashboard }, { label: "Chat", icon: MessageSquare }, { label: "Code", icon: Code2 },
  { label: "Preview", icon: Eye }, { label: "Files", icon: Files }, { label: "Assets", icon: ImageIcon }, { label: "Agents", icon: Bot },
];
const WORKSPACE_TABS: { id: WorkspaceView; label: string; icon: typeof Code2 }[] = [
  { id: "plan", label: "Plan", icon: Sparkles }, { id: "code", label: "Code", icon: Code2 }, { id: "preview", label: "Preview", icon: Eye }, { id: "review", label: "Review", icon: CircleCheck },
];

export default function StudioPhase10Showcase() {
  const [workspace, setWorkspace] = useState<WorkspaceView>("plan");
  const [inspector, setInspector] = useState<InspectorView>("review");
  const [actMode, setActMode] = useState(false);
  return (
    <main className="h-dvh min-h-[680px] overflow-hidden bg-[#07070a] text-[#f5f2fa]">
      <div className="grid h-full grid-cols-[68px_minmax(0,1fr)_320px] grid-rows-[52px_minmax(0,1fr)_92px] max-[960px]:grid-cols-[58px_minmax(0,1fr)] max-[960px]:grid-rows-[52px_minmax(0,1fr)_92px]">
        <header className="col-span-3 flex items-center gap-3 border-b border-white/8 bg-[#0b0a0f] px-3 max-[960px]:col-span-2">
          <div className="flex w-[54px] items-center gap-2 font-black"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#a970ff] text-[11px] text-white shadow-[0_0_22px_rgba(169,112,255,.3)]">LiTT</span></div>
          <button className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"><span className="truncate text-[12px] font-bold">litt-final-integration</span><ChevronDown size={12} className="text-white/35" /></button>
          <div className="hidden items-center gap-1 text-[10px] text-white/40 sm:flex"><GitBranch size={12} /> phase-10-studio <span className="mx-1">·</span><GitCommit size={12} /> 7f4a92c</div>
          <div className="flex-1" /><div className="hidden items-center gap-2 text-[10px] text-white/50 md:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#72f238] shadow-[0_0_8px_#72f238]" /> Runtime ready</div>
          <button className="rounded-lg border border-white/10 bg-white/[.03] px-2.5 py-1.5 text-[10px] font-bold">LiTT · Auto</button><button className="grid h-8 w-8 place-items-center rounded-lg text-white/45 hover:bg-white/5"><Search size={15} /></button>
        </header>

        <nav className="row-span-2 flex flex-col items-center gap-1 border-r border-white/8 bg-[#0b0a0f] px-1.5 py-2">
          {NAV.map(({ label, icon: Icon }) => <button key={label} className={`group relative flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[8px] font-bold transition ${label === "Studio" ? "bg-[#a970ff]/12 text-[#bf91ff]" : "text-white/38 hover:bg-white/5 hover:text-white/75"}`}>{label === "Studio" && <span className="absolute left-0 h-6 w-0.5 rounded-r bg-[#a970ff]" />}<Icon size={15} />{label}</button>)}
          <button className="mt-auto grid h-10 w-10 place-items-center rounded-lg text-white/35 hover:bg-white/5"><Settings size={16} /></button>
        </nav>

        <section className="relative flex min-w-0 flex-col overflow-hidden bg-[#08080c]">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/8 bg-[#0d0c12] px-2">
            {WORKSPACE_TABS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setWorkspace(id)} className={`flex h-9 items-center gap-1.5 border-b-2 px-3 text-[11px] font-bold transition ${workspace === id ? "border-[#a970ff] text-white" : "border-transparent text-white/38 hover:text-white/70"}`}><Icon size={13} />{label}</button>)}
            <div className="flex-1" /><button className="grid h-8 w-8 place-items-center rounded-md text-white/35 hover:bg-white/5"><MoreHorizontal size={15} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">{workspace === "plan" && <PlanWorkspace onOpenReview={() => setWorkspace("review")} />}{workspace === "code" && <CodeWorkspace />}{workspace === "preview" && <PreviewWorkspace />}{workspace === "review" && <ReviewWorkspace />}</div>
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-white/8 bg-[#0d0c12]/95 px-2.5 py-1.5 text-[9px] text-white/38 backdrop-blur-xl"><TerminalSquare size={12} /> Terminal <span className="h-1 w-1 rounded-full bg-[#72f238]" /> ready</div>
        </section>

        <aside className="row-span-2 flex min-h-0 flex-col border-l border-white/8 bg-[#0d0c12] max-[960px]:hidden">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/8 px-2">{(["plan", "changes", "checks", "review"] as InspectorView[]).map((id) => <button key={id} onClick={() => setInspector(id)} className={`rounded-md px-2 py-1.5 text-[9px] font-black uppercase tracking-[.08em] ${inspector === id ? "bg-white/[.06] text-white" : "text-white/32"}`}>{id}</button>)}</div>
          <InspectorBody view={inspector} />
        </aside>

        <footer className="col-start-2 row-start-3 border-t border-white/8 bg-[#0b0a0f] px-4 py-2.5">
          <div className="mx-auto grid h-full max-w-4xl grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[1fr_auto] gap-x-2 rounded-xl border border-white/10 bg-[#111017] px-3 py-2 shadow-[0_14px_50px_rgba(0,0,0,.35)] focus-within:border-[#a970ff]/55">
            <button className="row-span-2 self-center text-white/38 hover:text-white"><Paperclip size={16} /></button><input className="min-w-0 bg-transparent text-[12px] outline-none placeholder:text-white/28" placeholder={actMode ? "Tell LiTT what to build or change…" : "Ask LiTT to inspect, explain, or make a plan…"} /><button className="row-span-2 grid h-9 w-9 place-items-center self-center rounded-lg bg-[#a970ff] text-white shadow-[0_0_20px_rgba(169,112,255,.26)]"><ArrowUp size={16} /></button>
            <div className="flex items-center gap-1"><button onClick={() => setActMode(false)} className={`rounded px-2 py-0.5 text-[9px] font-black ${!actMode ? "bg-[#a970ff]/14 text-[#bf91ff]" : "text-white/30"}`}>PLAN</button><button onClick={() => setActMode(true)} className={`rounded px-2 py-0.5 text-[9px] font-black ${actMode ? "bg-[#72f238]/12 text-[#8cff52]" : "text-white/30"}`}>ACT</button><span className="ml-1 text-[9px] text-white/25">4 files in context</span></div>
          </div>
        </footer>
      </div>
    </main>
  );
}

function PlanWorkspace({ onOpenReview }: { onOpenReview: () => void }) {
  return <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(250px,.65fr)]">
    <section className="relative min-h-[300px] overflow-hidden rounded-2xl border border-[#a970ff]/20 bg-[#0e0d14]"><Image src="/studio/litt-code-command-center.png" alt="LiTT Code command center" fill priority sizes="900px" className="object-cover object-[58%_center] opacity-48" /><div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,7,13,.98)_0%,rgba(8,7,13,.9)_42%,rgba(8,7,13,.28)_100%)]" /><div className="relative z-10 flex min-h-[300px] max-w-md flex-col justify-between p-6"><div><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.18em] text-[#8cff52]"><span className="h-1.5 w-1.5 rounded-full bg-[#72f238]" /> Workspace online</div><h1 className="mt-4 text-3xl font-black tracking-[-.04em]">Build with proof,<br />not guesswork.</h1><p className="mt-3 text-[12px] leading-5 text-white/52">LiTT plans the work, edits the real project, runs checks, and ties approval to the exact code state.</p></div><div className="flex flex-wrap gap-2"><button className="flex items-center gap-2 rounded-lg bg-[#72f238] px-3.5 py-2 text-[10px] font-black text-[#071006]"><Play size={13} /> Continue build</button><button onClick={onOpenReview} className="rounded-lg border border-white/12 bg-black/25 px-3.5 py-2 text-[10px] font-bold">Review changes</button></div></div></section>
    <section className="rounded-2xl border border-white/8 bg-[#0e0d14] p-4"><div className="text-[9px] font-black uppercase tracking-[.16em] text-white/34">Current run</div><h2 className="mt-1.5 text-[15px] font-black">Studio UX design lock</h2><div className="mt-4 space-y-2.5">{[["Plan approved","done"],["Shell implemented","done"],["Checks verified","done"],["Visual review","active"]].map(([label,state],i)=><div key={label} className="flex items-center gap-2 text-[11px]"><span className={`grid h-5 w-5 place-items-center rounded-full border ${state === "done" ? "border-[#72f238]/30 bg-[#72f238]/8 text-[#72f238]" : "border-[#a970ff]/35 bg-[#a970ff]/10 text-[#bf91ff]"}`}>{state === "done" ? <Check size={11}/> : i+1}</span><span className={state === "active" ? "text-white" : "text-white/48"}>{label}</span></div>)}</div></section>
    <section className="lg:col-span-2"><div className="mb-2 text-[9px] font-black uppercase tracking-[.16em] text-white/30">LiTT artwork · available in Assets</div><div className="grid grid-cols-3 gap-2">{[["/studio/litt-builds-the-rest.png","Build"],["/studio/littree-lab-studios.png","Create"],["/studio/litt-code-command-center.png","Code"]].map(([src,label])=><button key={src} className="group relative aspect-[2.2/1] overflow-hidden rounded-xl border border-white/8 bg-[#0e0d14]"><Image src={src} alt={label} fill sizes="300px" className="object-cover opacity-65 transition group-hover:scale-[1.02] group-hover:opacity-90" /><span className="absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-[9px] font-black uppercase tracking-[.1em]">{label}</span></button>)}</div></section>
  </div>;
}

function CodeWorkspace(){return <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-white/8 bg-[#0d0c12]"><div className="flex h-10 items-center gap-2 border-b border-white/8 px-3 text-[10px]"><FileCode2 size={13} className="text-[#a970ff]"/><b>StudioReviewPanel.tsx</b><span className="text-white/30">src/components/studio</span></div><pre className="overflow-auto p-5 text-[11px] leading-6 text-white/56"><code><span className="text-[#bf91ff]">export function</span> StudioReviewPanel&#40;&#123; readiness &#125;&#41; &#123;{`\n`}  <span className="text-[#72f238]">return</span> &#40;{`\n`}    &lt;ReviewSurface{`\n`}      checkpoint=&#123;readiness.gitSha&#125;{`\n`}      checks=&#123;readiness.checks&#125;{`\n`}      acceptance=&#123;readiness.acceptance&#125;{`\n`}    /&gt;{`\n`}  &#41;;{`\n`}&#125;</code></pre></div>}
function PreviewWorkspace(){return <div className="mx-auto flex max-w-5xl items-center justify-center overflow-hidden rounded-2xl border border-white/8 bg-[#0d0c12] p-3"><div className="relative aspect-video w-full overflow-hidden rounded-xl"><Image src="/studio/littree-lab-studios.png" alt="LiTT preview" fill sizes="1000px" className="object-cover" /></div></div>}
function ReviewWorkspace(){return <div className="mx-auto max-w-5xl"><div className="mb-4 flex items-center justify-between"><div><div className="text-[9px] font-black uppercase tracking-[.18em] text-[#72f238]">Ready for review</div><h1 className="mt-1 text-xl font-black">Studio Product + UX design lock</h1></div><button className="rounded-lg bg-[#a970ff] px-4 py-2.5 text-[10px] font-black">Approve exact checkpoint</button></div><div className="grid gap-3 md:grid-cols-2">{[["4 files changed","+152 −68",FileCode2],["Checks","7 passed",ShieldCheck],["Acceptance","6/6 verified",CircleCheck],["Evidence","Current · 7f4a92c",GitCommit]].map(([label,value,Icon])=><div key={String(label)} className="rounded-xl border border-white/8 bg-[#0e0d14] p-4"><div className="flex items-center gap-2 text-[10px] text-white/38"><Icon size={14} className="text-[#72f238]"/>{String(label)}</div><div className="mt-2 text-lg font-black">{String(value)}</div></div>)}</div></div>}
function InspectorBody({view}:{view:InspectorView}){const content={plan:["Lock five-region shell","Consolidate intelligence","Build review state","Verify responsive layouts"],changes:["StudioBrandHero.tsx","LiTEmptyState.tsx","MissionControlDashboard.tsx","StudioReviewPanel.tsx"],checks:["Typecheck · Passed","Tests · 583 passed","Accessibility · Passed","Visual gate · Ready"],review:["4 files changed","7 checks passed","6/6 acceptance criteria","0 stale evidence"]}[view];return <div className="min-h-0 flex-1 overflow-auto p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#72f238]/10 text-[#72f238]"><Check size={17}/></div><div><div className="text-[12px] font-black">{view === "review" ? "Ready for review" : view[0].toUpperCase()+view.slice(1)}</div><div className="text-[9px] text-white/32">Exact state · 7f4a92c</div></div></div><div className="mt-5 space-y-1.5">{content.map((item,i)=><div key={item} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[.018] px-2.5 py-2 text-[10px]"><span className="grid h-4 w-4 place-items-center rounded-full bg-[#72f238]/8 text-[#72f238]">{view === "plan" ? i+1 : <Check size={9}/>}</span><span className="min-w-0 flex-1 truncate text-white/58">{item}</span></div>)}</div>{view === "review" && <div className="mt-5 space-y-2"><button className="w-full rounded-lg border border-white/10 py-2.5 text-[10px] font-bold">Request changes</button><button className="w-full rounded-lg bg-[#a970ff] py-2.5 text-[10px] font-black">Approve exact checkpoint</button></div>}<div className="mt-6 border-t border-white/8 pt-4"><div className="text-[9px] font-black uppercase tracking-[.14em] text-white/28">Run activity</div><div className="mt-3 flex items-start gap-2 text-[10px] text-white/40"><Activity size={12} className="mt-0.5 text-[#a970ff]"/><span>LiTT verified the review state against the latest checkpoint.</span></div></div></div>}
