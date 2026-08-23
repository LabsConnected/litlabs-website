"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowRight, Code2, Play, ScanSearch, Sparkles } from "lucide-react";

const BRAND_FRAMES = [
  {
    src: "/studio/litt-builds-the-rest.png",
    alt: "LiTTree LabStudios — bring the idea, LiTT builds the rest",
    eyebrow: "One brain. Many interfaces.",
    title: "Bring the idea. LiTT builds the rest.",
  },
  {
    src: "/studio/littree-lab-studios.png",
    alt: "LiTTree LabStudios creative AI command center",
    eyebrow: "Build. Create. Connect. Elevate.",
    title: "Your creative command center.",
  },
  {
    src: "/studio/litt-code-command-center.png",
    alt: "LiTT-Code AI engineer and system architect",
    eyebrow: "AI engineer. System architect.",
    title: "Real code. Real checks. Real deployment.",
  },
] as const;

export default function StudioBrandHero({ displayName, hasProject, projectName, onPickAction }: {
  displayName: string;
  hasProject: boolean;
  projectName: string | null;
  onPickAction: (prompt: string) => void;
}) {
  const [activeFrame, setActiveFrame] = useState(0);
  const frame = BRAND_FRAMES[activeFrame];

  return (
    <section
      className="group relative isolate min-h-[230px] overflow-hidden rounded-2xl border sm:min-h-[250px]"
      style={{ borderColor: "rgba(169,112,255,0.24)", backgroundColor: "#08070d", boxShadow: "0 16px 52px rgba(0,0,0,0.3), 0 0 0 1px rgba(114,242,56,0.04) inset" }}
      aria-label="LiTT Studio command center"
    >
      <Image key={frame.src} src={frame.src} alt={frame.alt} fill priority={activeFrame === 0} sizes="(max-width: 768px) 100vw, (max-width: 1280px) 85vw, 1100px" className="object-cover object-[62%_center] transition duration-500" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(5,4,9,0.99) 0%, rgba(5,4,9,0.94) 38%, rgba(5,4,9,0.46) 67%, rgba(5,4,9,0.18) 100%), linear-gradient(0deg, rgba(5,4,9,0.72) 0%, transparent 55%)" }} />

      <div className="relative z-10 flex min-h-[230px] max-w-lg flex-col justify-between p-5 sm:min-h-[250px] sm:p-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]" style={{ borderColor: "rgba(114,242,56,0.32)", backgroundColor: "rgba(7,12,8,0.72)", color: "#9dff5e", backdropFilter: "blur(12px)" }}>
            <span className="h-1.5 w-1.5 rounded-full bg-[#72f238] shadow-[0_0_10px_rgba(114,242,56,0.9)]" />
            {hasProject ? `${projectName ?? "Workspace"} online` : "Studio ready"}
          </div>
          <p className="mt-4 text-[9px] font-black uppercase tracking-[0.22em] text-[#b88cff]">{frame.eyebrow}</p>
          <h1 className="mt-1.5 max-w-md text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">{frame.title}</h1>
          <p className="mt-2 max-w-md text-[12px] leading-5 text-white/68">
            Welcome back, {displayName}. Plan the work, let LiTT build it, then review every change, check, and acceptance result in one place.
          </p>
        </div>

        <div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onPickAction("Build my idea in this project, then run checks and prepare it for review")} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#72f238] px-3.5 py-2 text-[11px] font-black text-[#071006] shadow-[0_0_22px_rgba(114,242,56,0.18)] transition hover:-translate-y-0.5 hover:bg-[#8cff52] active:translate-y-0">
              <Sparkles size={15} /> Start building <ArrowRight size={14} />
            </button>
            <button type="button" onClick={() => onPickAction("Scan this project, run every available check, and show me what needs attention")} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-black/45 px-3.5 py-2 text-[11px] font-bold text-white backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-[#a970ff]/60 hover:bg-[#a970ff]/10 active:translate-y-0">
              <ScanSearch size={15} /> Scan project
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2" aria-label="Choose Studio artwork">
            {BRAND_FRAMES.map((item, index) => (
              <button key={item.src} type="button" onClick={() => setActiveFrame(index)} className="relative h-8 w-14 overflow-hidden rounded-md border transition sm:h-9 sm:w-16" style={{ borderColor: index === activeFrame ? "#72f238" : "rgba(255,255,255,0.16)", boxShadow: index === activeFrame ? "0 0 0 1px #72f238, 0 0 14px rgba(114,242,56,0.2)" : "none", opacity: index === activeFrame ? 1 : 0.62 }} aria-label={`Show artwork ${index + 1}`} aria-pressed={index === activeFrame}>
                <Image src={item.src} alt="" fill sizes="96px" className="object-cover" />
              </button>
            ))}
            <div className="ml-1 hidden items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 sm:flex">
              <Code2 size={13} className="text-[#a970ff]" /> Code <Play size={13} className="ml-1 text-[#72f238]" /> Preview
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
