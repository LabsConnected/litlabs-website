"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import {
  BrainCircuit,
  Braces,
  Check,
  FileStack,
  ImageIcon,
  Mic2,
  Palette,
  Rocket,
  Sparkles,
  TestTube2,
  Workflow,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { LandingHeroV3 } from "@/components/landing/LandingHeroV3";
import { InteractiveProductDemo } from "@/components/landing/InteractiveProductDemo";
import { CapabilityStatus } from "@/components/landing/CapabilityStatus";
import { AgentCrew } from "@/components/landing/AgentCrew";
import { RealCreations } from "@/components/landing/RealCreations";
import { TrustSection } from "@/components/landing/TrustSection";
import { RealProductProof } from "@/components/landing/RealProductProof";
import { OnboardingSteps } from "@/components/landing/OnboardingSteps";
import { ComparisonTable } from "@/components/landing/ComparisonTable";
import { FAQSection } from "@/components/landing/FAQSection";
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
  return (
    <section id="creations" className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]">
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <SectionHeading
          eyebrow="From prompt to project"
          title={<>One system. <span className="litt-gradient-text">Very different outcomes.</span></>}
          copy="Explore transparent product demonstrations that show how LiTTree approaches product builds, dashboards, campaigns, and creative work."
        />
        <div className="mt-12"><RealCreations /></div>
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
      <CapabilityStatus />
      <CapabilityGrid />
      <MissionDemo />
      <RealProductProof />
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
      router.replace("/studio");
    }
  }, [clerkSignedIn, clerkLoaded, router]);

  return <LandingPage />;
}
