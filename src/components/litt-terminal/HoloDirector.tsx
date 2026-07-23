"use client";

import type { CSSProperties } from "react";

export type HoloState =
  | "idle"
  | "listening"
  | "planning"
  | "working"
  | "speaking"
  | "complete"
  | "error"
  | "approval";

const STATE_COPY: Record<HoloState, { label: string; color: string }> = {
  idle: { label: "Ready", color: "#22d3ee" },
  listening: { label: "Listening", color: "#22d3ee" },
  planning: { label: "Planning", color: "#a855f7" },
  working: { label: "Working", color: "#f97316" },
  speaking: { label: "Speaking", color: "#38bdf8" },
  complete: { label: "Complete", color: "#22c55e" },
  error: { label: "Needs attention", color: "#ef4444" },
  approval: { label: "Approval needed", color: "#f59e0b" },
};

export function HoloDirector({ state = "idle", compact = false }: { state?: HoloState; compact?: boolean }) {
  const config = STATE_COPY[state];
  return (
    <div className={`holo-stage relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#03070c]/80 ${compact ? "h-24" : "h-72 sm:h-80"}`} style={{ "--holo-color": config.color } as CSSProperties}>
      <style>{`
        @keyframes holo-float { 0%,100% { transform: translateY(0) rotateY(-3deg) } 50% { transform: translateY(-8px) rotateY(3deg) } }
        @keyframes holo-scan { 0% { transform: translateY(-110%) } 100% { transform: translateY(320%) } }
        @keyframes holo-ring { 0% { transform: translate(-50%,-50%) scale(.75); opacity:.8 } 100% { transform: translate(-50%,-50%) scale(1.35); opacity:0 } }
        @keyframes holo-orbit { to { transform: rotate(360deg) } }
        @keyframes holo-talk { 0%,100% { transform: scaleX(.45) } 50% { transform: scaleX(1) } }
        .holo-avatar { animation: holo-float 5s ease-in-out infinite; transform-style: preserve-3d; }
        .holo-scan { animation: holo-scan 3.4s linear infinite; }
        .holo-ring { animation: holo-ring 2.2s ease-out infinite; }
        .holo-orbit { animation: holo-orbit 9s linear infinite; }
        .holo-speaking { animation: holo-talk .25s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .holo-avatar,.holo-scan,.holo-ring,.holo-orbit,.holo-speaking { animation: none !important; } }
      `}</style>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--holo-color)_22%,transparent),transparent_52%),linear-gradient(135deg,rgba(8,47,73,.38),rgba(2,6,23,.94)_62%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(34,211,238,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.1)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="holo-scan absolute inset-x-0 top-0 h-16 bg-linear-to-b from-transparent via-cyan-300/15 to-transparent" />
      <div className="holo-ring absolute left-1/2 top-1/2 h-40 w-40 rounded-full border border-cyan-300/30" />
      <div className="holo-ring absolute left-1/2 top-1/2 h-40 w-40 rounded-full border border-fuchsia-300/25 [animation-delay:1.1s]" />
      <div className="holo-orbit absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-cyan-300/15"><span className="absolute -top-1 left-1/2 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_14px_#22d3ee]" /></div>

      <div className={`holo-avatar absolute left-1/2 ${compact ? "top-2 scale-[.42]" : "top-[12%] scale-90 sm:scale-100"} -translate-x-1/2`}>
        <div className="relative h-52 w-40 [filter:drop-shadow(0_0_18px_var(--holo-color))]">
          <div className="absolute left-1/2 top-0 h-24 w-20 -translate-x-1/2 rounded-[48%_48%_44%_44%] border border-cyan-200/55 bg-linear-to-b from-cyan-300/22 via-blue-500/12 to-fuchsia-500/15 shadow-[inset_0_0_28px_rgba(34,211,238,.25)]">
            <div className="absolute left-3 top-11 h-1 w-4 rounded-full bg-cyan-100 shadow-[0_0_8px_#67e8f9]" /><div className="absolute right-3 top-11 h-1 w-4 rounded-full bg-cyan-100 shadow-[0_0_8px_#67e8f9]" />
            <div className={`absolute bottom-5 left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-cyan-200/80 ${state === "speaking" ? "holo-speaking" : ""}`} />
            <div className="absolute inset-x-2 top-4 h-px bg-cyan-100/20 shadow-[0_14px_0_rgba(103,232,249,.1),0_28px_0_rgba(103,232,249,.1),0_42px_0_rgba(103,232,249,.1)]" />
          </div>
          <div className="absolute left-1/2 top-[86px] h-24 w-32 -translate-x-1/2 rounded-[50%_50%_20%_20%] border border-cyan-300/35 bg-linear-to-b from-cyan-400/16 to-fuchsia-500/10 [clip-path:polygon(22%_0,78%_0,100%_100%,0_100%)]" />
          <div className="absolute left-1/2 top-[108px] h-10 w-10 -translate-x-1/2 rotate-45 border border-cyan-200/50 bg-cyan-300/10 shadow-[0_0_18px_var(--holo-color)]" />
          <div className="absolute bottom-0 left-1/2 h-10 w-36 -translate-x-1/2 rounded-[50%] border-t border-cyan-300/40 bg-cyan-400/5 blur-[.2px]" />
        </div>
      </div>

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-white/80 backdrop-blur"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: config.color, boxShadow: `0 0 9px ${config.color}` }} /> {config.label}</div>
      {!compact && <div className="absolute inset-x-0 bottom-3 text-center"><div className="text-sm font-black tracking-[.22em] text-cyan-100">LiTT</div><div className="mt-1 text-[9px] uppercase tracking-[.2em] text-neutral-500">Private agent • Active workspace</div></div>}
    </div>
  );
}
