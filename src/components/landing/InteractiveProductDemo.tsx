"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { Check, CircleDot, FileCode, Folder, GitBranch, Play, Rocket, Send, Sparkles, Terminal } from "lucide-react";

/**
 * InteractiveProductDemo — Interactive product demonstration.
 *
 * This is an illustrative simulation of the LiTTree Studio workflow. It does
 * NOT represent a real mission execution. No real files are created, no real
 * deployment occurs, and no real URLs are shown.
 */

type DemoStage = "mission" | "plan" | "build" | "preview" | "approval" | "launch";

interface StageDef { id: DemoStage; label: string; icon: typeof Send; accent: string; description: string; }

const STAGES: StageDef[] = [
  { id: "mission", label: "Mission", icon: Sparkles, accent: "#a8ff2f", description: "LiTT turns your prompt into a structured mission with a clear goal." },
  { id: "plan", label: "Plan", icon: CircleDot, accent: "#65f4ff", description: "A step-by-step execution plan appears before any work begins." },
  { id: "build", label: "Build", icon: FileCode, accent: "#65f4ff", description: "Files, code, and assets are created in your project workspace." },
  { id: "preview", label: "Preview", icon: Play, accent: "#b58cff", description: "See the result as it's being built." },
  { id: "approval", label: "Approval", icon: Check, accent: "#b58cff", description: "Sensitive actions require your explicit approval before proceeding." },
  { id: "launch", label: "Launch", icon: Rocket, accent: "#a8ff2f", description: "Prepare the finished project for deployment when you're ready." },
];

export function InteractiveProductDemo() {
  const [active, setActive] = useState<DemoStage>("mission");
  const current = STAGES.find((s) => s.id === active)!;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(STAGES.length - 1, index));
    setActive(STAGES[clamped].id);
    tabRefs.current[clamped]?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusTab(0);
        break;
      case "End":
        e.preventDefault();
        focusTab(STAGES.length - 1);
        break;
    }
  };

  return (
    <div className="w-full">
      <div role="tablist" aria-label="LiTTree Studio workflow stages" className="mb-6 flex flex-wrap gap-2">
        {STAGES.map((stage, index) => {
          const isActive = stage.id === active;
          const Icon = stage.icon;
          return (
            <button
              key={stage.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls="demo-stage-panel"
              id={`demo-tab-${stage.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(stage.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-black transition-all duration-200 ${isActive ? "border-white/20 bg-white/8 text-white" : "border-white/8 bg-transparent text-white/40 hover:border-white/15 hover:text-white/70"}`}
              style={isActive ? { borderColor: `${stage.accent}40`, color: stage.accent } : undefined}>
              <Icon size={14} />{stage.label}
            </button>
          );
        })}
      </div>

      <div id="demo-stage-panel" role="tabpanel" aria-labelledby={`demo-tab-${active}`} className="overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] shadow-[0_30px_80px_rgba(0,0,0,.5)]">
        <div className="flex items-center gap-2 border-b border-white/8 bg-[#0d1018] px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-400/60" /><span className="h-3 w-3 rounded-full bg-amber-400/60" /><span className="h-3 w-3 rounded-full bg-green-400/60" />
          <div className="ml-3 flex min-w-0 items-center gap-2 text-xs font-bold text-white/40"><span className="relative h-5 w-5 shrink-0 overflow-hidden rounded"><Image src="/brand/litt-mascot-avatar.png" alt="LiTT" fill sizes="20px" className="object-cover" /></span><span className="truncate">LiTTree Studio &mdash; {current.label}</span></div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-white/30"><span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" />Connected</div>
        </div>

        <div className="flex min-h-[360px]">
          <div className="hidden w-48 shrink-0 border-r border-white/8 bg-[#080a10] p-3 sm:block">
            <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-white/30">Workspace</div>
            <div className="space-y-1">
              {[{ name: "mission.md", active: active === "mission" }, { name: "index.html", active: active === "build" || active === "preview" }, { name: "styles.css", active: active === "build" || active === "preview" }, { name: "player.js", active: active === "build" || active === "preview" }, { name: "assets/", active: active === "build" || active === "preview" }].map((file) => (
                <div key={file.name} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${file.active ? "bg-white/5 text-white/70" : "text-white/20"}`}>
                  {file.name.endsWith("/") ? <Folder size={12} className="shrink-0 text-[#65f4ff]/50" /> : <FileCode size={12} className="shrink-0 text-white/30" />}{file.name}
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-white/8 pt-3">
              <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-white/30">History</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] text-white/30"><GitBranch size={10} className="text-[#a8ff2f]/50" />Initial commit</div>
                {active !== "mission" && <div className="flex items-center gap-2 text-[10px] text-white/30"><GitBranch size={10} className="text-[#65f4ff]/50" />Checkpoint 1</div>}
                {(active === "launch" || active === "approval") && <div className="flex items-center gap-2 text-[10px] text-white/30"><GitBranch size={10} className="text-[#b58cff]/50" />Deploy checkpoint</div>}
              </div>
            </div>
          </div>

          <div className="flex-1 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ backgroundColor: `${current.accent}15`, color: current.accent }}><current.icon size={16} /></div>
              <div><div className="text-sm font-black" style={{ color: current.accent }}>{current.label}</div><div className="text-xs text-white/40">{current.description}</div></div>
            </div>
            <DemoStageContent stage={active} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoStageContent({ stage }: { stage: DemoStage }) {
  switch (stage) {
    case "mission":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/30">User prompt</div><div className="text-sm text-white/80">Build a premium launch page for an independent music artist named After Midnight.</div></div>
          <div className="rounded-xl border border-[#a8ff2f]/20 bg-[#a8ff2f]/5 p-4">
            <div className="mb-2 flex items-center gap-2"><Sparkles size={14} className="text-[#a8ff2f]" /><span className="text-[10px] font-black uppercase tracking-wider text-[#a8ff2f]">Mission</span></div>
            <div className="text-sm font-bold text-white/90">After Midnight &mdash; Artist Launch Page</div>
            <div className="mt-2 space-y-1 text-xs text-white/50"><div>&bull; Visual direction with brand colors</div><div>&bull; Release copy and artist bio</div><div>&bull; Organized project files</div><div>&bull; Responsive preview</div><div>&bull; Deployment preparation with approval</div></div>
          </div>
        </div>
      );
    case "plan":
      return (
        <div className="space-y-2">
          {["Create visual direction for After Midnight", "Write release copy and artist bio", "Organize project files (HTML, CSS, assets)", "Produce responsive preview", "Request approval before deployment", "Prepare for deployment on approval"].map((step, i) => (
            <div key={step} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#65f4ff]/10 text-[10px] font-black text-[#65f4ff]">{i + 1}</span>
              <span className="text-xs text-white/70">{step}</span><Check size={12} className="ml-auto shrink-0 text-[#a8ff2f]" />
            </div>
          ))}
        </div>
      );
    case "build":
      return (
        <div className="space-y-2">
          <div className="rounded-lg border border-white/8 bg-black/40 p-3 font-mono text-xs leading-5 text-white/60">
            <div className="text-[#65f4ff]">$ Creating workspace files...</div>
            <div className="text-white/40">  index.html &mdash; hero, bio, release section</div><div className="text-white/40">  styles.css &mdash; responsive layout, brand colors</div><div className="text-white/40">  assets/ &mdash; cover art, social images</div>
            <div className="mt-2 flex items-center gap-1.5 text-[#a8ff2f]"><Check size={11} /> Project files organized</div>
          </div>
          <div className="grid grid-cols-3 gap-2">{["index.html", "styles.css", "assets/"].map((f) => (<div key={f} className="rounded-lg border border-white/8 bg-white/3 p-2.5"><FileCode size={14} className="mb-1.5 text-[#65f4ff]/60" /><div className="text-[10px] font-bold text-white/60">{f}</div></div>))}</div>
        </div>
      );
    case "preview":
      return (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-purple-950/30 to-black/50">
            <div className="p-5">
              <div className="mb-4 flex items-center justify-between"><div className="text-[10px] font-black uppercase tracking-wider text-[#b58cff]">Responsive Preview</div><div className="flex gap-1"><span className="h-2 w-2 rounded-full bg-[#b58cff]/40" /><span className="h-2 w-2 rounded-full bg-white/10" /><span className="h-2 w-2 rounded-full bg-white/10" /></div></div>
              <div className="mb-4 h-28 rounded-lg bg-gradient-to-br from-[#1a0d2e] via-[#b58cff]/20 to-transparent" />
              <div className="mb-2 h-3 w-3/4 rounded bg-white/15" /><div className="mb-4 h-2 w-full rounded bg-white/8" />
              <div className="flex gap-3"><div className="h-10 w-10 rounded-full bg-[#b58cff]/25" /><div className="flex-1"><div className="h-2.5 w-24 rounded bg-white/15" /><div className="mt-1.5 h-1.5 w-16 rounded bg-white/8" /><div className="mt-1.5 h-1.5 w-20 rounded bg-white/8" /></div><Play size={16} className="mt-2 text-[#b58cff]" /></div>
            </div>
          </div>
          <div className="text-xs text-white/40">Preview updates as files change.</div>
        </div>
      );
    case "approval":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#b58cff]/25 bg-[#b58cff]/5 p-5">
            <div className="mb-3 flex items-center gap-2"><Check size={16} className="text-[#b58cff]" /><span className="text-xs font-black uppercase tracking-wider text-[#b58cff]">Approval Required</span></div>
            <div className="mb-4 text-sm text-white/80">LiTT wants to prepare the After Midnight launch page for deployment. Approve to proceed with deployment preparation.</div>
            <div className="mb-4 rounded-lg border border-white/8 bg-black/30 p-3 text-xs text-white/50"><div className="mb-1 font-bold text-white/70">What will happen:</div><div>&bull; Build the production bundle</div><div>&bull; Prepare for deployment</div><div>&bull; Save the project in your workspace</div></div>
            <div className="flex gap-2"><button className="rounded-lg bg-[#b58cff] px-5 py-2.5 text-xs font-black text-black transition hover:bg-[#c89dff]">Approve</button><button className="rounded-lg border border-white/15 px-5 py-2.5 text-xs font-bold text-white/50 transition hover:bg-white/5">Review changes first</button></div>
          </div>
          <div className="text-xs text-white/40">LiTT never deploys, deletes, or performs sensitive actions without your approval.</div>
        </div>
      );
    case "launch":
      return (
        <div className="space-y-3">
          <div className="rounded-lg border border-white/8 bg-black/40 p-3 font-mono text-xs leading-5 text-white/60">
            <div className="text-[#a8ff2f]">$ Preparing for deployment...</div>
            <div className="text-white/40">  Building production bundle</div><div className="text-white/40">  Verifying build output</div><div className="text-white/40">  Ready for deployment</div>
            <div className="mt-2 flex items-center gap-1.5"><Terminal size={11} className="text-[#a8ff2f]" /><span className="text-[#a8ff2f]">Deployment preparation complete</span></div>
          </div>
          <div className="flex flex-col items-center rounded-xl border border-[#a8ff2f]/20 bg-[#a8ff2f]/5 py-6 text-center">
            <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 shadow-[0_0_30px_rgba(168,255,47,.15)]"><GitBranch size={24} className="text-[#a8ff2f]" /></div>
            <div className="text-xl font-black text-white">Ready for Deployment.</div>
            <div className="mt-1 text-xs text-white/50">The After Midnight launch page is built and ready to deploy when you are.</div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-xs font-bold text-[#a8ff2f]"><span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" /> Project saved in your workspace</div>
          </div>
        </div>
      );
    default: return null;
  }
}
