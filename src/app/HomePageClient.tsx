"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Braces,
  Check,
  ChevronRight,
  FileStack,
  ImageIcon,
  Menu,
  Mic2,
  Palette,
  Rocket,
  Sparkles,
  TestTube2,
  Workflow,
  X,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { LandingHeroV3 } from "@/components/landing/LandingHeroV3";
import { InteractiveProductDemo } from "@/components/landing/InteractiveProductDemo";
import { CapabilityStatus } from "@/components/landing/CapabilityStatus";
import { AgentCrew } from "@/components/landing/AgentCrew";
import { RealCreations } from "@/components/landing/RealCreations";
import { WhyDifferent } from "@/components/landing/WhyDifferent";
import { TrustSection } from "@/components/landing/TrustSection";
import { useViewportReveals } from "@/components/landing/useViewportReveals";

const NAV_ITEMS = [
  { label: "Capabilities", href: "#what-we-do" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Studio", href: "#operator" },
  { label: "Creations", href: "#creations" },
  { label: "Community", href: "/discover" },
] as const;

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

function BrandMark() {
  return (
    <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 text-[#a8ff2f] shadow-[0_0_26px_rgba(168,255,47,.16)]">
      <Bot size={18} />
      <span className="absolute inset-x-1 bottom-0 h-px bg-linear-to-r from-transparent via-[#a8ff2f] to-transparent" />
    </span>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className="litt-site-header fixed inset-x-0 top-0 z-50 border-b border-white/8">
      <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between px-5 lg:px-8">
        <Link
          href="/"
          aria-label="LiTTree LabStudios home"
          className="flex items-center gap-2.5 font-black tracking-[-0.02em] text-white"
        >
          <BrandMark />
          <span className="hidden sm:block">LiTTree <span className="text-white/48">LabStudios</span></span>
          <span className="sm:hidden">LiTTree</span>
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-7 text-[13px] font-bold text-white/55 lg:flex">
          {NAV_ITEMS.map((item) =>
            item.href.startsWith("#") ? (
              <a key={item.href} href={item.href} className="litt-nav-link">
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className="litt-nav-link">
                {item.label}
              </Link>
            ),
          )}
          <Link href="/pricing" className="litt-nav-link">Pricing</Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden px-3 py-2 text-sm font-bold text-white/55 transition hover:text-white sm:block">
            Sign in
          </Link>
          <Link href="/sign-up" className="litt-primary-button !min-h-10 !px-4 !py-2 text-sm">
            Start free <ArrowRight size={14} />
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white lg:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="border-t border-white/8 bg-[#05070d]/96 px-5 py-4 backdrop-blur-2xl lg:hidden"
        >
          <div className="mx-auto grid max-w-[1500px] gap-1">
            {NAV_ITEMS.map((item) =>
              item.href.startsWith("#") ? (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-white/72 hover:bg-white/5 hover:text-white"
                >
                  {item.label} <ChevronRight size={15} />
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-white/72 hover:bg-white/5 hover:text-white"
                >
                  {item.label} <ChevronRight size={15} />
                </Link>
              ),
            )}
            <Link href="/pricing" onClick={() => setMenuOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-bold text-white/72 hover:bg-white/5 hover:text-white">
              Pricing <ChevronRight size={15} />
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

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
            title={<>Not a chat. <span className="litt-gradient-text">A working system.</span></>}
            copy="Step through a complete mission—from your brief to a verified, approval-ready result. Every stage has a purpose, an owner, and visible output."
          />
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {[{ icon: Mic2, label: "Talk" }, { icon: ImageIcon, label: "Create" }, { icon: Braces, label: "Build" }, { icon: Rocket, label: "Launch" }].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-2 text-xs font-bold text-white/60">
                <Icon size={13} className="text-[#a8ff2f]" /> {label}
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

function WhySection() {
  return (
    <section className="litt-section relative overflow-hidden border-t border-white/8">
      <div className="litt-grid-fade pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <SectionHeading
          eyebrow="Built for finishing"
          title={<>The difference is what <span className="litt-gradient-text">survives the chat.</span></>}
          copy="LiTTree creates durable project state: files, context, checkpoints, approvals, and a path to launch. Your work keeps moving even after the conversation ends."
        />
        <div className="mt-12"><WhyDifferent /></div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/8 bg-[#03050a] px-5 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-8 md:grid-cols-[1.2fr_2fr] md:items-end">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5 font-black text-white"><BrandMark /> LiTTree LabStudios</Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/38">An AI creative operating system for turning ideas into real, ownable work.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold text-white/42 md:justify-end">
          <Link href="/studio" className="litt-footer-link">Studio</Link>
          <Link href="/agents" className="litt-footer-link">Agents</Link>
          <Link href="/marketplace" className="litt-footer-link">Marketplace</Link>
          <Link href="/gallery" className="litt-footer-link">Gallery</Link>
          <Link href="/discover" className="litt-footer-link">Community</Link>
          <Link href="/pricing" className="litt-footer-link">Pricing</Link>
          <Link href="/privacy" className="litt-footer-link">Privacy</Link>
          <Link href="/terms" className="litt-footer-link">Terms</Link>
        </div>
      </div>
    </footer>
  );
}

function LandingPage() {
  const landingRef = useRef<HTMLElement>(null);
  useViewportReveals(landingRef);

  return (
    <main ref={landingRef} id="main-content" className="litt-landing min-h-dvh overflow-hidden bg-[#03050a] text-white selection:bg-[#a8ff2f] selection:text-[#03050a]">
      <Header />
      <LandingHeroV3 />
      <CapabilityStatus />
      <CapabilityGrid />
      <MissionDemo />
      <AgentCrew />
      <CreationsSection />
      <WhySection />
      <TrustSection />
      <Footer />
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
