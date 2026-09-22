"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Braces,
  Check,
  FileCode2,
  FileStack,
  GitBranch,
  ImageIcon,
  Mic2,
  Palette,
  Play,
  Rocket,
  Sparkles,
  Terminal,
  TestTube2,
  Workflow,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
// Above-the-fold sections stay in the main bundle.
import { LandingHeroV3 } from "@/components/landing/LandingHeroV3";
// Below-the-fold sections are code-split (ssr: true keeps them in the
// server-rendered HTML for SEO; the client JS loads on demand). This
// keeps the initial homepage JS payload to hero + capabilities.
const InteractiveProductDemo = dynamic(
  () => import("@/components/landing/InteractiveProductDemo").then((m) => m.InteractiveProductDemo),
  { ssr: true },
);
const AgentCrew = dynamic(
  () => import("@/components/landing/AgentCrew").then((m) => m.AgentCrew),
  { ssr: true },
);
const RealCreations = dynamic(
  () => import("@/components/landing/RealCreations").then((m) => m.RealCreations),
  { ssr: true },
);
const TrustSection = dynamic(
  () => import("@/components/landing/TrustSection").then((m) => m.TrustSection),
  { ssr: true },
);
const OnboardingSteps = dynamic(
  () => import("@/components/landing/OnboardingSteps").then((m) => m.OnboardingSteps),
  { ssr: true },
);
const ComparisonTable = dynamic(
  () => import("@/components/landing/ComparisonTable").then((m) => m.ComparisonTable),
  { ssr: true },
);
const FAQSection = dynamic(
  () => import("@/components/landing/FAQSection").then((m) => m.FAQSection),
  { ssr: true },
);
import { useViewportReveals } from "@/components/landing/useViewportReveals";

const CAPABILITIES = [
  {
    title: "Build digital products",
    copy: "Turn a plain-language brief into working sites, apps, dashboards, automations, and internal tools—with organized code and a live preview.",
    eyebrow: "Design + engineering",
    icon: Braces,
    accent: "green",
    size: "wide",
    points: ["Product strategy", "UI and code", "Responsive builds", "Git-ready files"],
  },
  {
    title: "Create the full brand world",
    copy: "Give LiTT a creative direction and coordinate visual direction, branding, images, copy, audio concepts, and campaign assets that stay on brand.",
    eyebrow: "Creative production",
    icon: Palette,
    accent: "violet",
    size: "standard",
    points: ["Visual direction", "Branding", "Images and copy", "Audio concepts", "Campaign assets"],
  },
  {
    title: "Run real workflows",
    copy: "LiTT plans the mission, selects tools, edits the project, and keeps the work moving across code, files, terminal, research, and deployment.",
    eyebrow: "Orchestration",
    icon: Workflow,
    accent: "cyan",
    size: "standard",
    points: ["Mission planning", "Tool routing", "Multi-step execution"],
  },
  {
    title: "Keep the context",
    copy: "Goals, decisions, files, and project history carry forward. Return tomorrow without rebuilding the entire conversation.",
    eyebrow: "Project memory",
    icon: BrainCircuit,
    accent: "violet",
    size: "standard",
    points: ["Persistent memory", "Project history", "Recoverable checkpoints"],
  },
  {
    title: "Verify before you ship",
    copy: "Tests, previews, diffs, and approval gates make the result visible before sensitive actions happen.",
    eyebrow: "Quality + control",
    icon: TestTube2,
    accent: "green",
    size: "standard",
    points: ["Tests and checks", "Human approvals", "Safe changes"],
  },
  {
    title: "Own the result",
    copy: "Your code, files, images, audio, and documents live in your workspace and remain exportable—ready to launch or take anywhere.",
    eyebrow: "Files + launch",
    icon: FileStack,
    accent: "cyan",
    size: "wide",
    points: ["Real project files", "Export anytime", "Deployment workflow", "No lock-in"],
  },
] as const;

// Trailer assets live in `public/demos/`:
// - litt-trailer.webm (VP9, 720x1280) — primary source; plays in every
//   modern browser including Chromium builds without proprietary codecs
// - litt-trailer.mp4 (H.264, 720x1280) — fallback for older players
// - litt-trailer-poster.jpg (720x1280)
const VIDEO_SOURCES = [
  { src: "/demos/litt-trailer.webm", type: "video/webm" },
  { src: "/demos/litt-trailer.mp4", type: "video/mp4" },
];
const POSTER_SRC = "/demos/litt-trailer-poster.jpg";

const DEMO_STEPS = [
  { label: "Mission understood", icon: Check },
  { label: "Plan generated", icon: Check },
  { label: "Files changing", icon: FileCode2 },
  { label: "Terminal executing", icon: Terminal },
  { label: "Preview updating", icon: Play },
  { label: "Verification passed", icon: Check },
  { label: "Approval ready", icon: GitBranch },
];

// The real LiTT product trailer is live in public/demos/.
const HAS_REAL_VIDEO = true;

function SectionHeading({
  eyebrow,
  title,
  copy,
  align = "center",
}: {
  eyebrow: string;
  title: React.ReactNode;
  copy: string;
  align?: "left" | "center";
}) {
  return (
    <div data-reveal className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
      <div className="litt-eyebrow justify-center data-[align=left]:justify-start" data-align={align}>
        <Sparkles size={13} /> {eyebrow}
      </div>
      <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
        {title}
      </h2>
      <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">{copy}</p>
    </div>
  );
}

function CapabilityGrid() {
  return (
    <section id="what-we-do" className="litt-section relative overflow-hidden border-t border-white/8">
      <div className="litt-grid-fade pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        {/* Availability status (folded in from CapabilityStatus): the unique
            "working now" signal + beta tag. The per-capability chips were
            folded into the grid cards below to remove duplicated messaging. */}
        <div data-reveal className="mb-12 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex shrink-0 items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-45" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent shadow-accent-glow-strong" />
            </span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">Working now</div>
              <div className="mt-0.5 text-xs font-semibold text-white/42">Core capabilities available in Studio</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[10px] font-black uppercase tracking-[0.14em]">
            <span className="rounded-full border border-amber-300/16 bg-amber-300/6 px-3 py-2 text-amber-200/78">Voice · Terminal · Deploy <span className="text-white/30">Beta</span></span>
            <Link href="/pricing" className="hidden items-center gap-1.5 text-white/40 transition hover:text-white sm:inline-flex">
              Compare plans <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>

        <SectionHeading
          eyebrow="One workspace, the whole creative loop"
          title={<>Everything between <span className="litt-gradient-text">idea and done.</span></>}
          copy="LiTTree combines planning, engineering, creative production, project memory, and launch control—so the work stays connected from the first prompt to the final result."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {CAPABILITIES.map((capability, index) => {
            const Icon = capability.icon;
            return (
              <article
                key={capability.title}
                data-reveal
                className={`litt-bento-card litt-accent-${capability.accent} ${capability.size === "wide" ? "xl:col-span-2" : ""}`}
                style={{ "--reveal-index": index } as React.CSSProperties}
              >
                <div className="relative z-10 flex h-full flex-col p-6 sm:p-7">
                  <div className="flex items-center justify-between gap-4">
                    <span className="litt-capability-icon"><Icon size={20} /></span>
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">{capability.eyebrow}</span>
                  </div>
                  <h3 className="mt-8 text-2xl font-black tracking-[-0.035em] text-white">{capability.title}</h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/52">{capability.copy}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {capability.points.map((point) => (
                      <span key={point} className="litt-capability-tag inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[10px] font-bold text-white/55">
                        <Check size={10} className="text-current" /> {point}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MissionDemo() {
  return (
    <section id="how-it-works" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-violet-600/8 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
          <SectionHeading
            align="left"
            eyebrow="See the work happen"
            title={<>Brief in. <span className="litt-gradient-text">Verified work out.</span></>}
            copy="Step through a complete mission—from your brief to a verified, approval-ready result. Every stage has a purpose, an owner, and visible output."
          />
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {[{ icon: Mic2, label: "Talk" }, { icon: ImageIcon, label: "Create" }, { icon: Braces, label: "Build" }, { icon: Rocket, label: "Launch" }].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-2 text-xs font-bold text-white/60">
                <Icon size={13} className="text-accent" /> {label}
              </span>
            ))}
          </div>
        </div>
        <div data-reveal className="litt-demo-shell mt-12">
          <InteractiveProductDemo />
        </div>
      </div>
    </section>
  );
}

function CreationsSection() {
  const handleWatchClick = () => {
    track("watch_litt_click", { source: "real_proof" });
  };

  return (
    <section id="creations" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[680px] -translate-x-1/2 rounded-full bg-accent/6 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        {/* Proof: the real product trailer (folded in from RealProductProof) */}
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Play size={13} /> Real session
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            See LiTT work on a <span className="litt-gradient-text">real project.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            A real LiTT session. Real project files. Real tools. Real output.
          </p>
        </div>

        <div data-reveal className="mt-12">
          {HAS_REAL_VIDEO ? (
            <div className="mx-auto max-w-[380px]">
              <div className="litt-demo-shell overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,.55)]">
                <video
                  className="aspect-[9/16] w-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  poster={POSTER_SRC}
                  controls
                  preload="metadata"
                >
                  {VIDEO_SOURCES.map((s) => (
                    <source key={s.src} src={s.src} type={s.type} />
                  ))}
                </video>
              </div>
            </div>
          ) : (
            <div className="litt-video-placeholder">
              <div className="litt-video-placeholder-inner">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl border border-accent/24 bg-accent/8 text-accent shadow-accent-glow">
                    <Play size={28} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-white">A mission, step by step</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/42">
                      Every LiTT session follows the same visible path — understand
                      the brief, plan the work, edit real files, run tools, verify
                      the result, and hand it back to you.
                    </p>
                  </div>
                </div>

                <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {DEMO_STEPS.map((step, index) => {
                    const Icon = step.icon;
                    return (
                      <div
                        key={step.label}
                        className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-[#05070d] px-3 py-3"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/5 font-mono text-[10px] font-black text-accent">
                          0{index + 1}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/58">
                          <Icon size={12} className="text-[#65f4ff]" />
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Creations: the product-demonstration cards */}
        <div className="mt-20 sm:mt-24">
          <SectionHeading
            eyebrow="From prompt to project"
            title={<>One system. <span className="litt-gradient-text">Very different outcomes.</span></>}
            copy="Explore transparent product demonstrations that show how LiTTree approaches product builds, dashboards, campaigns, and creative work."
          />
          <div className="mt-12"><RealCreations /></div>
        </div>

        <div data-reveal className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/sign-up"
            className="litt-primary-button"
            onClick={() => track("hero_cta_click", { source: "real_proof" })}
          >
            Start building free <ArrowRight size={16} />
          </Link>
          <a
            href="#how-it-works"
            className="litt-secondary-button"
            onClick={handleWatchClick}
          >
            <Play size={13} fill="currentColor" /> See the walkthrough
          </a>
          <Link
            href="/showcase/artist-launch-site"
            className="litt-secondary-button"
          >
            See an example session <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function LandingPage() {
  const landingRef = useRef<HTMLElement>(null);
  useViewportReveals(landingRef);

  return (
    <main ref={landingRef} id="main-content" className="litt-landing min-h-dvh overflow-hidden bg-[#03050a] text-white selection:bg-accent selection:text-on-accent">
      <LandingHeroV3 />
      <CapabilityGrid />
      <MissionDemo />
      <ComparisonTable />
      <AgentCrew />
      <CreationsSection />
      <OnboardingSteps />
      <TrustSection />
      <FAQSection />
    </main>
  );
}

export default function HomePageClient() {
  const { isSignedIn: clerkSignedIn, isLoaded: clerkLoaded } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    track("homepage_view");
  }, []);

  useEffect(() => {
    if (!clerkLoaded) return;
    if (clerkSignedIn) {
      track("returning_user");
      router.replace("/dashboard");
    }
  }, [clerkSignedIn, clerkLoaded, router]);

  return <LandingPage />;
}
