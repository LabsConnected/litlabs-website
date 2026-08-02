"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  CircleDot,
  Code2,
  FileCode,
  Folder,
  GitBranch,
  Palette,
  Play,
  Rocket,
  Send,
  Shield,
  Sparkles,
  Terminal,
  Users,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";

/* ΓöÇΓöÇ Asset Inventory ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
const ASSET_INVENTORY = [
  { path: "/brand/litt-alive.mp4", type: "Video", used: "Hero ΓÇö LiTT comes to life" },
  { path: "/brand/litt-alive-poster.webp", type: "Image", used: "Hero ΓÇö reduced-motion poster" },
  { path: "/brand/litt-base-station.png", type: "Image", used: "Studio demo screenshot" },
  { path: "/brand/litt-agent-hero-v2.png", type: "Image", used: "LiTT agent card" },
  { path: "/brand/spark-agent-hero-v2.png", type: "Image", used: "Spark agent card" },
  { path: "/brand/litt-mascot-avatar.png", type: "Image", used: "LiTT avatar / favicon" },
  { path: "/brand/litt-mascot-hero.png", type: "Image", used: "LiTT full hero (unused ΓÇö candidate)" },
  { path: "/brand/spark-agent-portrait.png", type: "Image", used: "Spark portrait (unused ΓÇö candidate)" },
];

/* ΓöÇΓöÇ Section Order ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
const SECTION_ORDER = [
  { id: "hero", label: "Hero", status: "done" },
  { id: "mission-demo", label: "Mission Demo", status: "done" },
  { id: "studio-proof", label: "Studio Proof", status: "wireframe" },
  { id: "dashboard-proof", label: "Dashboard Proof", status: "placeholder" },
  { id: "showcase", label: "Real Showcase", status: "placeholder" },
  { id: "marketplace", label: "Marketplace", status: "wireframe" },
  { id: "how-it-works", label: "How It Works", status: "wireframe" },
  { id: "ownership", label: "Ownership & Trust", status: "wireframe" },
  { id: "cta", label: "Final CTA", status: "wireframe" },
  { id: "footer", label: "Footer", status: "wireframe" },
];

/* ΓöÇΓöÇ Checkpoint Banner ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function CheckpointBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-400/30 bg-amber-950/90 px-4 py-2 text-center text-xs font-semibold text-amber-200 backdrop-blur-xl">
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        Checkpoint 2 ΓÇö Mission Animation &amp; Product Demo ┬╖ /preview/landing-v2 ┬╖ Not indexed
      </span>
    </div>
  );
}

/* ΓöÇΓöÇ Section Order Sidebar ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function SectionOrderPanel() {
  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-64 rounded-2xl border border-white/15 bg-black/90 p-4 text-xs backdrop-blur-xl">
      <div className="mb-3 font-black uppercase tracking-wider text-white/60">Section Order</div>
      <ol className="space-y-1.5">
        {SECTION_ORDER.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="font-mono text-white/30">{String(i + 1).padStart(2, "0")}</span>
            <span className="font-semibold text-white/80">{s.label}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
              s.status === "wireframe" ? "bg-amber-500/20 text-amber-300" : "bg-white/10 text-white/40"
            }`}>
              {s.status}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ΓöÇΓöÇ Asset Inventory Panel ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function AssetInventoryPanel() {
  return (
    <details className="fixed bottom-4 left-4 z-[100] max-w-80 rounded-2xl border border-white/15 bg-black/90 backdrop-blur-xl">
      <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-wider text-white/60">
        Asset Inventory ({ASSET_INVENTORY.length})
      </summary>
      <div className="max-h-72 overflow-y-auto px-4 pb-4">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-white/40">
              <th className="pb-2 font-semibold">Path</th>
              <th className="pb-2 font-semibold">Type</th>
              <th className="pb-2 font-semibold">Used</th>
            </tr>
          </thead>
          <tbody>
            {ASSET_INVENTORY.map((a) => (
              <tr key={a.path} className="border-t border-white/5">
                <td className="py-1.5 font-mono text-cyan-300/80">{a.path}</td>
                <td className="py-1.5 text-white/50">{a.type}</td>
                <td className="py-1.5 text-white/40">{a.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ΓöÇΓöÇ Wireframe Section Wrapper ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function WireframeSection({
  id,
  label,
  children,
  className = "",
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-wireframe
      className={`relative border-b border-dashed border-white/10 ${className}`}
    >
      <div className="absolute left-3 top-3 z-10 rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white/30">
        {label}
      </div>
      {children}
    </section>
  );
}

/* ΓöÇΓöÇ Hero (Desktop + Mobile) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function Hero() {
  return (
    <WireframeSection id="hero" label="01 ┬╖ Hero" className="min-h-screen pt-16">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_35%,rgba(169,112,255,.18),transparent_32%),radial-gradient(circle_at_22%_24%,rgba(168,255,47,.10),transparent_27%)]" />
      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] bg-size-[64px_64px]" />

      <div className="relative mx-auto grid max-w-screen-2xl items-center gap-12 px-5 py-16 lg:min-h-screen lg:grid-cols-[1fr_0.85fr] lg:px-10 lg:py-20">
        {/* Left: copy */}
        <div className="relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-[11px] font-black uppercase tracking-[.18em] text-[#a8ff2f]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#a8ff2f]" />
            AI creative studio + creator community
          </div>

          <h1 className="max-w-3xl text-5xl font-black leading-[.94] tracking-[-.055em] sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
            Bring the idea.
            <span className="mt-3 block bg-linear-to-r from-[#a8ff2f] via-[#7efbff] to-[#a970ff] bg-clip-text text-transparent">
              LiTT helps you build the rest.
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/65">
            Build apps, create art, make media, and launch real projects with an
            AI crew that remembers your goals, style, and decisions.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-[#a8ff2f] to-[#5df5d0] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:shadow-[0_0_55px_rgba(168,255,47,.38)]"
            >
              Start creating free <ArrowRight size={16} />
            </Link>
            <Link
              href="/studio?demo=1"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-300/10 px-6 py-4 text-sm font-black text-amber-200 transition hover:-translate-y-1 hover:border-amber-300/70 hover:bg-amber-300/15"
            >
              <Play size={15} fill="currentColor" /> Try Studio without signing in
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/45">
            <span className="flex items-center gap-1.5"><Check size={11} className="text-[#a8ff2f]" /> Free to join</span>
            <span className="flex items-center gap-1.5"><Check size={11} className="text-[#a8ff2f]" /> 500 starter credits</span>
            <span className="flex items-center gap-1.5"><Check size={11} className="text-[#a8ff2f]" /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check size={11} className="text-[#a8ff2f]" /> Your work stays yours</span>
          </div>
        </div>

        {/* Right: LiTT visual */}
        <div className="relative mx-auto w-full max-w-[34rem]">
          <div className="absolute inset-10 rounded-full bg-[#a8ff2f]/20 blur-[90px]" />
          <div className="relative overflow-hidden rounded-4xl border border-white/15 bg-black/40 shadow-[0_35px_100px_rgba(0,0,0,.65)]">
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/brand/litt-alive-poster.webp"
              aria-label="LiTT comes to life and welcomes you to the lab"
              className="aspect-[4/4.55] w-full object-cover object-center motion-reduce:hidden"
            >
              <source src="/brand/litt-alive.mp4" type="video/mp4" />
            </video>
            <Image
              src="/brand/litt-alive-poster.webp"
              alt="LiTT, your friendly AI creative copilot"
              width={1280}
              height={784}
              priority
              className="hidden aspect-[4/4.55] w-full object-cover object-center motion-reduce:block"
            />
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/70 to-transparent px-6 pb-6 pt-24">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[.22em] text-[#a8ff2f]">LiTT</div>
                  <div className="mt-1 text-2xl font-black">Your AI crew</div>
                  <p className="mt-1 text-sm text-white/60">Plans the mission. Keeps everything moving.</p>
                </div>
                <span className="shrink-0 rounded-full border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#a8ff2f]">Online</span>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-5 -left-4 rounded-2xl border border-white/15 bg-[#10120f]/90 p-4 shadow-2xl backdrop-blur-xl sm:-left-10">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#a970ff] text-black"><WandSparkles size={18} /></span>
              <div><div className="text-xs font-black">Ready for a mission</div><div className="text-[11px] text-white/45">Build ┬╖ Create ┬╖ Learn ┬╖ Launch</div></div>
            </div>
          </div>
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Mission Demo Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
type MissionStageId =
  | "prompt"
  | "mission"
  | "plan"
  | "build"
  | "preview"
  | "approval"
  | "deploy"
  | "live";

interface MissionStage {
  id: MissionStageId;
  label: string;
  icon: typeof Send;
  accent: string;
}

const MISSION_STAGES: MissionStage[] = [
  { id: "prompt", label: "Prompt", icon: Send, accent: "#a8ff2f" },
  { id: "mission", label: "Mission", icon: Sparkles, accent: "#a8ff2f" },
  { id: "plan", label: "Plan", icon: CircleDot, accent: "#65f4ff" },
  { id: "build", label: "Build", icon: FileCode, accent: "#65f4ff" },
  { id: "preview", label: "Preview", icon: Play, accent: "#b58cff" },
  { id: "approval", label: "Approval", icon: Check, accent: "#b58cff" },
  { id: "deploy", label: "Deploy", icon: Rocket, accent: "#a8ff2f" },
  { id: "live", label: "Live", icon: GitBranch, accent: "#a8ff2f" },
];

const STAGE_DURATION = 3000;

/* ΓöÇΓöÇ Mission Demo (After Midnight golden demo) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function MissionDemo() {
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
      if (prev >= MISSION_STAGES.length - 1) {
        setCompleted(true);
        return prev;
      }
      return prev + 1;
    });
  }, []);

  useEffect(() => {
    if (paused || completed || reducedMotion) return;
    if (reducedMotion) {
      setStageIndex(MISSION_STAGES.length - 1);
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

  const currentStage = MISSION_STAGES[stageIndex];
  const progress = ((stageIndex + 1) / MISSION_STAGES.length) * 100;

  return (
    <WireframeSection id="mission-demo" label="02 ┬╖ Mission Demo" className="bg-[#05070d] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">Golden Demo Mission</div>
        <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] text-white sm:text-5xl">
          Watch LiTT build a launch page.
        </h2>
        <p className="mt-5 text-lg leading-8 text-white/55">
          A real mission from prompt to deployment: branding, copywriting, files,
          preview, approval, and launch ΓÇö all from one sentence.
        </p>
      </div>

      <div
        className="relative mx-auto mt-14 max-w-4xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        {/* Product frame */}
        <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] shadow-[0_30px_80px_rgba(0,0,0,.5)]">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-white/8 bg-[#0d1018] px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400/60" />
            <span className="h-3 w-3 rounded-full bg-amber-400/60" />
            <span className="h-3 w-3 rounded-full bg-green-400/60" />
            <div className="ml-3 flex items-center gap-2 text-xs font-bold text-white/40">
              <span className="grid h-5 w-5 place-items-center rounded bg-[#a8ff2f]/15 text-[10px] text-[#a8ff2f]">L</span>
              LiTTree Studio ΓÇö After Midnight Launch
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-white/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" />
              Connected
            </div>
          </div>

          {/* Stage content area */}
          <div className="relative min-h-[340px] sm:min-h-[380px]">
            <div className="flex h-full">
              {/* Sidebar */}
              <div className="hidden w-44 shrink-0 border-r border-white/8 bg-[#080a10] p-3 sm:block">
                <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-white/30">Workspace</div>
                <div className="space-y-1">
                  {["mission.md", "index.html", "styles.css", "branding/", "copy.md", "assets/"].map((file, i) => (
                    <div
                      key={file}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-all duration-500 ${
                        stageIndex >= 2 && i <= (stageIndex >= 5 ? 5 : stageIndex - 1)
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

              {/* Main content */}
              <div className="flex-1 p-4 sm:p-5">
                {/* Stage indicator */}
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
                    {stageIndex + 1} / {MISSION_STAGES.length}
                  </span>
                </div>

                {/* Stage-specific content */}
                <div className="min-h-[240px]">
                  <MissionStageContent stage={currentStage.id} />
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-0.5 bg-white/5">
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${progress}%`,
                backgroundColor: currentStage.accent,
              }}
            />
          </div>
        </div>

        {/* Replay button */}
        {completed && (
          <button
            onClick={replay}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 transition hover:border-[#a8ff2f]/40 hover:text-[#a8ff2f]"
          >
            <Play size={12} fill="currentColor" /> Replay mission
          </button>
        )}

        {/* Pause indicator */}
        {paused && !completed && (
          <div className="absolute right-4 top-16 rounded-md bg-black/80 px-2 py-1 text-[10px] font-bold text-white/50">
            Paused
          </div>
        )}
      </div>

      {/* Stage pills */}
      <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-2">
        {MISSION_STAGES.map((s, i) => (
          <div
            key={s.id}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all duration-300 ${
              i === stageIndex
                ? "border text-black"
                : i < stageIndex
                  ? "border border-white/15 bg-white/5 text-white/40"
                  : "border border-white/8 text-white/20"
            }`}
            style={
              i === stageIndex
                ? { backgroundColor: s.accent, borderColor: s.accent }
                : undefined
            }
          >
            <s.icon size={11} />
            {s.label}
          </div>
        ))}
      </div>
    </WireframeSection>
  );
}

/** Renders the content for each stage of the After Midnight mission. */
function MissionStageContent({ stage }: { stage: MissionStageId }) {
  switch (stage) {
    case "prompt":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/30">User</div>
            <div className="flex items-start gap-2">
              <span className="text-sm text-white/80">
                Build a premium launch page for an independent music artist named
                After Midnight. Create the visual direction, write the release copy,
                organize the project files, produce a responsive preview, and ask me
                before preparing it for deployment.
              </span>
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
            <div className="text-sm font-bold text-white/90">After Midnight ΓÇö Artist Launch Page</div>
            <div className="mt-1 text-xs text-white/50">
              Goal: A polished, responsive artist site with visual direction, release
              copy, organized files, and a preview ΓÇö pending approval before deployment.
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <ArrowRight size={12} className="text-[#65f4ff]" />
            Generating execution plan...
          </div>
        </div>
      );

    case "plan":
      return (
        <div className="space-y-2">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#65f4ff]">Execution Plan</div>
          {[
            "Define visual direction (dark, neon, moody)",
            "Write release copy for hero and bio",
            "Create index.html with responsive layout",
            "Style with CSS ΓÇö mobile-first",
            "Organize project files and assets",
            "Produce preview and request approval",
          ].map((step, i) => (
            <div
              key={step}
              className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2 transition-all duration-300"
              style={{
                opacity: i <= 3 ? 1 : 0.3,
                transform: `translateX(${i <= 3 ? 0 : 8}px)`,
              }}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#65f4ff]/10 text-[10px] font-black text-[#65f4ff]">
                {i + 1}
              </span>
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
            <div className="text-[#65f4ff]">ΓåÆ Creating branding/visual-direction.md</div>
            <div className="text-white/40">  dark palette, neon accents, moody atmosphere</div>
            <div className="text-[#65f4ff]">ΓåÆ Writing copy/release-copy.md</div>
            <div className="text-white/40">  hero headline, bio, social links</div>
            <div className="text-[#65f4ff]">ΓåÆ Creating index.html</div>
            <div className="text-white/40">  responsive layout, hero, music player, tour dates</div>
            <div className="text-[#65f4ff]">ΓåÆ Creating styles.css</div>
            <div className="text-white/40">  mobile-first, neon grid, typography</div>
            <div className="mt-2 flex items-center gap-1.5 text-[#a8ff2f]">
              <Check size={11} /> 4 files created ┬╖ 0 errors
            </div>
          </div>
        </div>
      );

    case "preview":
      return (
        <div className="space-y-2">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b58cff]">Live Preview</div>
          <div className="overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-purple-950/40 to-black/60">
            <div className="p-4">
              {/* Mock artist page preview */}
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-black tracking-wider text-[#b58cff]">AFTER MIDNIGHT</div>
                <div className="text-[10px] text-white/30">New single ΓÇö Out now</div>
              </div>
              <div className="mb-3 h-28 rounded-lg bg-gradient-to-br from-[#b58cff]/30 via-[#1a0d2e] to-[#a8ff2f]/10" />
              <div className="mb-2 h-3 w-3/4 rounded bg-white/15" />
              <div className="mb-3 h-2 w-full rounded bg-white/8" />
              <div className="flex gap-2">
                <div className="h-8 w-8 rounded-full bg-[#b58cff]/30" />
                <div className="flex-1">
                  <div className="h-2 w-20 rounded bg-white/15" />
                  <div className="mt-1 h-1.5 w-16 rounded bg-white/8" />
                </div>
                <div className="h-8 w-8 rounded-full bg-[#a8ff2f]/20" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Play size={11} className="text-[#b58cff]" /> Preview rendering ΓÇö responsive check passed
          </div>
        </div>
      );

    case "approval":
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#b58cff]/25 bg-[#b58cff]/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Check size={14} className="text-[#b58cff]" />
              <span className="text-[10px] font-black uppercase tracking-wider text-[#b58cff]">Approval Required</span>
            </div>
            <div className="text-sm text-white/80">
              LiTT has finished building the launch page and is ready to prepare it
              for deployment. Approve to proceed, or review the files first.
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded-lg bg-[#b58cff] px-4 py-2 text-xs font-black text-black transition hover:bg-[#c89dff]">
                Approve &amp; Prepare Deploy
              </button>
              <button className="rounded-lg border border-white/15 px-4 py-2 text-xs font-bold text-white/50 transition hover:bg-white/5">
                Review files first
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <Shield size={12} className="text-[#b58cff]" />
            LiTT will not deploy without your approval.
          </div>
        </div>
      );

    case "deploy":
      return (
        <div className="space-y-2">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#a8ff2f]">Deploying</div>
          <div className="rounded-lg border border-white/8 bg-black/40 p-3 font-mono text-xs leading-5 text-white/60">
            <div className="text-[#a8ff2f]">ΓåÆ Building production bundle...</div>
            <div className="text-white/40">  4 files, 0 errors, responsive verified</div>
            <div className="text-[#a8ff2f]">ΓåÆ Uploading to edge network...</div>
            <div className="text-white/40">  CDN distribution active</div>
            <div className="mt-2 flex items-center gap-1.5">
              <Terminal size={11} className="text-[#a8ff2f]" />
              <span className="text-[#a8ff2f]">Deployment complete</span>
            </div>
          </div>
        </div>
      );

    case "live":
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 shadow-[0_0_40px_rgba(168,255,47,.2)]">
            <GitBranch size={28} className="text-[#a8ff2f]" />
          </div>
          <div className="text-2xl font-black text-white">Live.</div>
          <div className="mt-1 text-sm text-white/50">After Midnight&apos;s launch page is deployed and ready to share.</div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-xs font-bold text-[#a8ff2f]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#a8ff2f]" />
            after-midnight.litlabs.net
          </div>
          <div className="mt-3 flex gap-3 text-xs text-white/30">
            <span className="flex items-center gap-1"><Check size={10} className="text-[#a8ff2f]" /> Responsive</span>
            <span className="flex items-center gap-1"><Check size={10} className="text-[#a8ff2f]" /> Files saved</span>
            <span className="flex items-center gap-1"><Check size={10} className="text-[#a8ff2f]" /> Checkpoint created</span>
          </div>
        </div>
      );

    default:
      return null;
  }
}

/* ΓöÇΓöÇ Studio Proof ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function StudioProof() {
  return (
    <WireframeSection id="studio-proof" label="03 ┬╖ Studio Proof" className="bg-[#05070d] px-5 py-20 text-white lg:px-10 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
          One place to think, build, create, and finish.
        </h2>
        <p className="mt-5 text-lg leading-8 text-white/55">
          LiTT keeps your conversations, files, projects, creative direction,
          and tools connectedΓÇöso every session starts where the last one ended.
        </p>
      </div>
      <div className="relative mt-14 overflow-hidden rounded-3xl border border-white/12 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55)]">
        <div className="relative aspect-video">
          <Image src="/brand/litt-base-station.png" alt="LiTTree Studio command center interface" fill className="object-cover" priority />
          <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
        </div>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Bot, title: "Talk naturally", copy: "Describe what you want in plain language. LiTT understands the goal." },
          { icon: Code2, title: "Build real projects", copy: "Code, assets, and files are created and organized as you go." },
          { icon: Shield, title: "Keep project memory", copy: "Decisions, style, and context carry forward across every session." },
        ].map(({ icon: Icon, title, copy }) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-white/3 p-6">
            <Icon size={22} className="text-[#a8ff2f]" />
            <div className="mt-4 text-base font-black">{title}</div>
            <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
          </div>
        ))}
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Dashboard Proof (placeholder) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function DashboardProofPlaceholder() {
  return (
    <WireframeSection id="dashboard-proof" label="04 ┬╖ Dashboard Proof" className="bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Dashboard V2</div>
        <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] text-white/40 sm:text-5xl">
          Your creator command center.
        </h2>
        <p className="mt-5 text-lg leading-8 text-white/30">
          LiTT Daily Brief, Continue Project, Current Mission, Unified Inbox,
          Recent Work, Community Pulse, System Health, Quick Create.
        </p>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["Daily Brief", "Continue Project", "Current Mission", "Unified Inbox", "Recent Work", "Community Pulse", "System Health", "Quick Create"].map((label) => (
            <div key={label} className="rounded-xl border border-dashed border-white/10 bg-white/2 p-5 text-center text-sm font-bold text-white/30">
              {label}
            </div>
          ))}
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Showcase (placeholder) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function ShowcasePlaceholder() {
  return (
    <WireframeSection id="showcase" label="05 ┬╖ Real Showcase" className="bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">Built inside LiTTree</div>
        <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] text-white/40 sm:text-5xl">
          Real projects from real creators.
        </h2>
        <p className="mt-5 text-lg leading-8 text-white/30">
          Three showcase projects will be built and featured here:
          LiTTree artist launch, Local business starter, Creator command center.
        </p>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {[
            { title: "LiTTree Artist Launch", desc: "Website, branding, cover art, bio, social campaign" },
            { title: "Local Business Starter", desc: "Landing page, appointment flow, contact form, deployment" },
            { title: "Creator Command Center", desc: "Dashboard, saved project memory, files, approvals, launch" },
          ].map((p) => (
            <div key={p.title} className="rounded-2xl border border-dashed border-white/10 bg-white/2 p-6">
              <div className="text-lg font-black text-white/40">{p.title}</div>
              <p className="mt-2 text-sm text-white/25">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Marketplace ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function Marketplace() {
  const agents = [
    { name: "LiTT Growth", category: "Marketing", color: "#a8ff2f", icon: Rocket },
    { name: "LiTT Social", category: "Content", color: "#ec4899", icon: Users },
    { name: "LiTT Coder Pro", category: "Developer", color: "#818cf8", icon: Code2 },
  ];
  return (
    <WireframeSection id="marketplace" label="06 ┬╖ Marketplace" className="bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-screen-2xl">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Marketplace</div>
            <h2 className="mt-4 max-w-2xl text-4xl font-black leading-[.98] tracking-[-.045em] text-white sm:text-5xl">
              Add new skills when the mission needs them.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/55">
              Install community agents, templates, themes, and toolsΓÇöor publish
              your own for other creators.
            </p>
          </div>
          <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm font-black text-[#a8ff2f]">
            Browse marketplace <ArrowRight size={15} />
          </Link>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {agents.map(({ name, category, color, icon: Icon }) => (
            <Link
              key={name}
              href="/marketplace"
              className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/2 p-5 transition duration-300 hover:-translate-y-1 hover:border-[#a8ff2f]/25"
            >
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
                style={{ backgroundColor: `${color}20`, color }}
              >
                <Icon size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">{name}</div>
                <div className="text-xs text-white/40">{category}</div>
              </div>
              <ArrowRight size={14} className="shrink-0 text-white/25 transition group-hover:text-[#a8ff2f]" />
            </Link>
          ))}
        </div>
        <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/70">
          <strong className="font-bold">Preview note:</strong> Premium agent checkout
          (Stripe prices, webhook configuration) is not yet production-ready.
          Agents are shown for discovery only.
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ How It Works ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function HowItWorks() {
  const steps = [
    ["01", "Describe the outcome", "Start with an idea, a problem, or an existing project."],
    ["02", "Build alongside your crew", "LiTT organizes the work while the right creative and technical tools help produce it."],
    ["03", "Review and direct", "See what is happening, approve important actions, and change direction anytime."],
    ["04", "Save, share, or launch", "Keep it private, publish it, invite collaborators, or ship it."],
  ];
  return (
    <WireframeSection id="how-it-works" label="07 ┬╖ How It Works" className="bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-screen-2xl">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] text-white sm:text-5xl">
            You lead. LiTT keeps the momentum.
          </h2>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([number, title, copy]) => (
            <div key={number} className="bg-[#0c0f0b] p-7 sm:p-8">
              <div className="font-mono text-xs font-black text-[#a8ff2f]">{number}</div>
              <h3 className="mt-8 text-xl font-black text-white">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/50">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Ownership & Trust ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function Ownership() {
  const points = [
    { icon: Shield, title: "You own your creations", copy: "Everything you build is yours. Export your content anytime." },
    { icon: Sparkles, title: "Keep a free creative space", copy: "Your profile, community, and creative space will always have a free option." },
    { icon: Palette, title: "Control who can see them", copy: "Public, private, or friends-only. You decide who sees what." },
    { icon: Rocket, title: "Export your work", copy: "Take your content and creations with you. No lock-in." },
  ];
  return (
    <WireframeSection id="ownership" label="08 ┬╖ Ownership & Trust" className="bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-screen-2xl">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] text-white sm:text-5xl">
            Your work. Your identity. Your rules.
          </h2>
        </div>
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {points.map(({ icon: Icon, title, copy }) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/2 p-6">
              <Icon size={24} className="text-[#a8ff2f]" />
              <div className="mt-4 text-base font-black text-white">{title}</div>
              <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Final CTA ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function FinalCTA() {
  return (
    <WireframeSection id="cta" label="09 ┬╖ Final CTA" className="overflow-hidden bg-[#060912] px-5 py-20 text-white lg:px-10 lg:py-24">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(168,255,47,.16),transparent_30%),radial-gradient(circle_at_85%_65%,rgba(169,112,255,.2),transparent_34%)]" />
      <div className="relative mx-auto flex max-w-screen-2xl flex-col justify-between gap-10 lg:flex-row lg:items-end">
        <div>
          <h2 className="max-w-4xl text-5xl font-black leading-[.95] tracking-tighter sm:text-6xl lg:text-7xl">
            Your next idea deserves more than
            <span className="block bg-linear-to-r from-[#a8ff2f] via-[#65f4ff] to-[#b58cff] bg-clip-text text-transparent">
              another empty chat.
            </span>
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-white/55">
            Give it a project, a crew, and a place to grow.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href="/sign-up"
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:bg-[#b8ff5f] hover:shadow-[0_0_50px_rgba(168,255,47,.35)]"
          >
            Start creating free <ArrowRight size={16} />
          </Link>
          <Link
            href="/studio?demo=1"
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold text-white transition hover:border-white/30 hover:bg-white/10"
          >
            <Play size={14} fill="currentColor" /> Try the Studio
          </Link>
          <div className="mt-1 text-xs font-semibold text-white/40">500 starter credits ┬╖ No credit card required</div>
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Footer ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
function Footer() {
  return (
    <WireframeSection id="footer" label="10 ┬╖ Footer" className="bg-[#050706] px-5 py-8 lg:px-10">
      <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 text-xs text-white/35 sm:flex-row">
        <div className="flex items-center gap-2 font-black text-white">
          <Sparkles size={14} className="text-[#a8ff2f]" /> LiTTree LabStudios
        </div>
        <div className="flex flex-wrap gap-5">
          <Link href="/studio">Studio</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/gallery">Gallery</Link>
          <Link href="/games">Games</Link>
          <Link href="/discover">Community</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>
    </WireframeSection>
  );
}

/* ΓöÇΓöÇ Page ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */
export default function LandingV2Client() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#03050a] text-white selection:bg-[#a970ff] selection:text-white">
      <CheckpointBanner />
      <Hero />
      <MissionDemo />
      <StudioProof />
      <DashboardProofPlaceholder />
      <ShowcasePlaceholder />
      <Marketplace />
      <HowItWorks />
      <Ownership />
      <FinalCTA />
      <Footer />
      <SectionOrderPanel />
      <AssetInventoryPanel />
    </main>
  );
}
