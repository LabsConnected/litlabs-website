"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowRight,
  Check,
  CircleDot,
  FileCode,
  Folder,
  GitBranch,
  Play,
  Rocket,
  Send,
  Sparkles,
  Terminal,
} from "lucide-react";

type StageId = "prompt" | "mission" | "plan" | "build" | "preview" | "approval" | "deploy" | "live";

interface Stage {
  id: StageId;
  label: string;
  icon: typeof Send;
  accent: string;
}

const STAGES: Stage[] = [
  { id: "prompt", label: "Prompt", icon: Send, accent: "#a8ff2f" },
  { id: "mission", label: "Mission", icon: Sparkles, accent: "#a8ff2f" },
  { id: "plan", label: "Plan", icon: CircleDot, accent: "#65f4ff" },
  { id: "build", label: "Build", icon: FileCode, accent: "#65f4ff" },
  { id: "preview", label: "Preview", icon: Play, accent: "#b58cff" },
  { id: "approval", label: "Approval", icon: Check, accent: "#b58cff" },
  { id: "deploy", label: "Deploy", icon: Rocket, accent: "#a8ff2f" },
  { id: "live", label: "Live", icon: GitBranch, accent: "#a8ff2f" },
];

const STAGE_DURATION = 2800;

export function MissionSequence() {
  const [stageIndex, setStageIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const advance = useCallback(() => {
    setStageIndex((prev) => {
      if (prev >= STAGES.length - 1) {
        setCompleted(true);
        return prev;
      }
      return prev + 1;
    });
  }, []);

  useEffect(() => {
    if (paused || completed || reducedMotion) return;
    if (reducedMotion) {
      setStageIndex(STAGES.length - 1);
      setCompleted(true);
      return;
    }
    const timer = setTimeout(advance, STAGE_DURATION);
    return () => clearTimeout(timer);
  }, [stageIndex, paused, completed, reducedMotion, advance]);

  const replay = () => {
    setStageIndex(0);
    setCompleted(false);
  };

  const currentStage = STAGES[stageIndex];
  const progress = ((stageIndex + 1) / STAGES.length) * 100;

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] shadow-[0_30px_80px_rgba(0,0,0,.5)]">
        <div className="flex items-center gap-2 border-b border-white/8 bg-[#0d1018] px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-400/60" />
          <span className="h-3 w-3 rounded-full bg-amber-400/60" />
          <span className="h-3 w-3 rounded-full bg-green-400/60" />
          <div className="ml-3 flex items-center gap-2 text-xs font-bold text-white/40">
            <span className="grid h-5 w-5 place-items-center rounded bg-[#a8ff2f]/15 text-[10px] text-[#a8ff2f]">L</span>
            LiTTree Studio
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-white/30">
            <span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" />
            Connected
          </div>
        </div>

        <div className="relative min-h-[340px] sm:min-h-[380px]">
          <div className="flex h-full">
            <div className="hidden w-44 shrink-0 border-r border-white/8 bg-[#080a10] p-3 sm:block">
              <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-white/30">Workspace</div>
              <div className="space-y-1">
                {["mission.md", "index.html", "styles.css", "assets/"].map((file, i) => (
                  <div
                    key={file}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-all duration-500 ${
                      stageIndex >= 2 && i <= (stageIndex >= 5 ? 3 : stageIndex - 1)
                        ? "bg-white/5 text-white/70"
                        : "text-white/20"
                    }`}
                  >
                    {file.endsWith("/") ? (
                      <Folder size={12} className="shrink-0 text-[#65f4ff]/50" />
                    ) : (
                      <FileCode size={12} className="shrink-0 text-white/30" />
                    )}
                    {file}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <div
                  className="grid h-7 w-7 place-items-center rounded-lg transition-colors duration-300"
                  style={{ backgroundColor: `${currentStage.accent}15`, color: currentStage.accent }}
                >
                  <currentStage.icon size={14} />
                </div>
                <span className="text-sm font-black" style={{ color: currentStage.accent }}>
                  {currentStage.label}
                </span>
                <span className="ml-auto text-[10px] font-bold text-white/25">
                  {stageIndex + 1} / {STAGES.length}
                </span>
              </div>

              <div className="min-h-[240px]">
                <StageContent stage={currentStage.id} />
              </div>
            </div>
          </div>
        </div>

        <div className="h-0.5 bg-white/5">
          <div
            className="h-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%`, backgroundColor: currentStage.accent }}
          />
        </div>
      </div>

      {completed && (
        <button
          onClick={replay}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 transition hover:border-[#a8ff2f]/40 hover:text-[#a8ff2f]"
        >
          <Play size={12} fill="currentColor" /> Replay sequence
        </button>
      )}
    </div>
  );
}

function StageContent({ stage }: { stage: StageId }) {
  switch (stage) {
    case "prompt":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/30">User</div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-sm text-white/80">Build me a premium website for my music.</span>
              <Send size={14} className="mt-0.5 shrink-0 text-[#a8ff2f]" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <div className="h-1 w-1 animate-pulse rounded-full bg-[#a8ff2f]" />
            LiTT is reading the request...
          </div>
        </div>
      );
    case "mission":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#a8ff2f]/20 bg-[#a8ff2f]/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-[#a8ff2f]" />
              <span className="text-[10px] font-black uppercase tracking-wider text-[#a8ff2f]">Mission Created</span>
            </div>
            <div className="text-sm font-bold text-white/90">Premium Music Artist Website</div>
            <div className="mt-1 text-xs text-white/50">Goal: A polished, responsive artist site with hero, music player, tour dates, and merch link.</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <ArrowRight size={12} className="text-[#65f4ff]" /> Generating plan...
          </div>
        </div>
      );
    case "plan":
      return (
        <div className="space-y-2">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#65f4ff]">Execution Plan</div>
          {["Design hero section with artist image", "Build responsive layout (mobile-first)", "Add music player component", "Create tour dates section", "Link merch store", "Optimize and deploy preview"].map((step, i) => (
            <div key={step} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2 transition-all duration-300" style={{ opacity: i <= 3 ? 1 : 0.3, transform: `translateX(${i <= 3 ? 0 : 8}px)` }}>
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#65f4ff]/10 text-[10px] font-black text-[#65f4ff]">{i + 1}</span>
              <span className="text-xs text-white/70">{step}</span>
              {i < 3 && <Check size={12} className="ml-auto shrink-0 text-[#a8ff2f]" />}
            </div>
          ))}
        </div>
      );
    case "build":
      return (
        <div className="space-y-2">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#65f4ff]">Building Files</div>
          <div className="rounded-lg border border-white/8 bg-black/40 p-3 font-mono text-xs leading-5 text-white/60">
            <div className="text-[#65f4ff]">&rarr; Creating index.html</div>
            <div className="text-white/40">  hero section, nav, footer</div>
            <div className="text-[#65f4ff]">&rarr; Creating styles.css</div>
            <div className="text-white/40">  responsive grid, typography</div>
            <div className="text-[#65f4ff]">&rarr; Creating player.js</div>
            <div className="text-white/40">  audio controller, track list</div>
            <div className="mt-2 flex items-center gap-1.5 text-[#a8ff2f]"><Check size={11} /> 3 files created</div>
          </div>
        </div>
      );
    case "preview":
      return (
        <div className="space-y-2">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b58cff]">Live Preview</div>
          <div className="overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-purple-950/40 to-black/60">
            <div className="p-4">
              <div className="mb-3 h-24 rounded-lg bg-gradient-to-br from-[#b58cff]/30 to-[#a8ff2f]/10" />
              <div className="mb-2 h-3 w-3/4 rounded bg-white/15" />
              <div className="mb-3 h-2 w-full rounded bg-white/8" />
              <div className="flex gap-2">
                <div className="h-8 w-8 rounded-full bg-[#b58cff]/30" />
                <div className="flex-1"><div className="h-2 w-20 rounded bg-white/15" /><div className="mt-1 h-1.5 w-16 rounded bg-white/8" /></div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40"><Play size={11} className="text-[#b58cff]" /> Preview rendering...</div>
        </div>
      );
    case "approval":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#b58cff]/25 bg-[#b58cff]/5 p-4">
            <div className="mb-2 flex items-center gap-2"><Check size={14} className="text-[#b58cff]" /><span className="text-[10px] font-black uppercase tracking-wider text-[#b58cff]">Approval Required</span></div>
            <div className="text-sm text-white/80">LiTT wants to deploy the preview. Approve to make it live.</div>
            <div className="mt-3 flex gap-2">
              <button className="rounded-lg bg-[#b58cff] px-4 py-2 text-xs font-black text-black transition hover:bg-[#c89dff]">Approve &amp; Deploy</button>
              <button className="rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-white/50 transition hover:bg-white/5">Review first</button>
            </div>
          </div>
        </div>
      );
    case "deploy":
      return (
        <div className="space-y-2">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#a8ff2f]">Deploying</div>
          <div className="rounded-lg border border-white/8 bg-black/40 p-3 font-mono text-xs leading-5 text-white/60">
            <div className="text-[#a8ff2f]">&rarr; Building production bundle...</div>
            <div className="text-white/40">  3 files, 0 errors</div>
            <div className="text-[#a8ff2f]">&rarr; Uploading to edge network...</div>
            <div className="text-white/40">  CDN distribution active</div>
            <div className="mt-2 flex items-center gap-1.5"><Terminal size={11} className="text-[#a8ff2f]" /><span className="text-[#a8ff2f]">Deployment complete</span></div>
          </div>
        </div>
      );
    case "live":
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 shadow-[0_0_40px_rgba(168,255,47,.2)]"><GitBranch size={28} className="text-[#a8ff2f]" /></div>
          <div className="text-2xl font-black text-white">Live.</div>
          <div className="mt-1 text-sm text-white/50">Your music site is deployed and ready to share.</div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-xs font-bold text-[#a8ff2f]"><span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" />https://your-music.litlabs.net</div>
        </div>
      );
    default:
      return null;
  }
}
