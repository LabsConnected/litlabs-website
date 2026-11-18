"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Braces,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Database,
  FileCheck2,
  FileStack,
  Mic,
  MoonStar,
  Palette,
  Rocket,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Wand2,
  Workflow,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import "@/app/homepage-tlc.css";
import "@/app/homepage-mockup.css";

/* ============================================================
   Homepage — mockup port (2026-11-18)

   Larry approved porting his uploaded marketing mockup
   (Littree_Labstudios_Mockup_Pages) as the new homepage.
   The sections below follow that mockup's layout and copy,
   adapted to the real site: CTAs point at real routes, and
   the mockup's simulated workspace panel is labeled as an
   example / recorded preview (the site's truth standard —
   a simulated panel is never presented as a live feed).
   Prices: the mockup homepage shows no plan prices; the
   canonical tiers live in src/config/plans.ts and /pricing.
   ============================================================ */

function MpPill({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "purple" | "white";
}) {
  const c =
    tone === "green"
      ? "border-[var(--hm-green)]/40 bg-[var(--hm-green)]/10 text-[var(--hm-green)]"
      : tone === "purple"
        ? "border-purple-400/40 bg-purple-500/10 text-purple-300"
        : "border-white/20 bg-white/5 text-white";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${c}`}
    >
      {children}
    </span>
  );
}

function MpSectionHead({
  kicker,
  title,
  copy,
  align = "left",
}: {
  kicker: string;
  title: React.ReactNode;
  copy?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={`${align === "center" ? "mx-auto items-center text-center" : ""} flex max-w-3xl flex-col gap-3`}>
      <span className="hm-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--hm-green)]">{kicker}</span>
      <h2 className="text-[clamp(1.85rem,5vw,3.25rem)] font-bold leading-[0.98] tracking-tight">{title}</h2>
      {copy && <p className="text-base leading-relaxed text-[#b9b9cd] sm:text-lg">{copy}</p>}
    </div>
  );
}

function MpCheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm leading-relaxed text-[#c8c8da]">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--hm-green)]/15 text-[var(--hm-green)]">
        <Check size={13} />
      </span>
      {children}
    </li>
  );
}

const HOME_FAQS = [
  {
    q: "Is LiTT a chatbot with a code box?",
    a: "No. LiTT is a complete building workspace. You describe the outcome, then watch the plan, preview, checks, files, and launch happen in one connected loop.",
  },
  {
    q: "What happens if a build fails?",
    a: "You are charged 0 LiTTBits on a failed build. The workspace keeps the context, shows what went wrong, and helps you retry without starting over.",
  },
  {
    q: "Can I export or leave with my work?",
    a: "Yes. Export anytime. Your files, project memory, and launch history stay under your control — no lock-in by design.",
  },
  {
    q: "Does LiTT work for creative projects too?",
    a: "Yes. Design, copy, audio direction, visual production, and engineering can live in the same mission, with one operator keeping the whole project coherent.",
  },
] as const;

function HeroSection() {
  const [mission, setMission] = useState(2);

  return (
    <section className="hm-noise hm-grid-bg relative overflow-hidden border-b border-white/10">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-4 pb-12 pt-28 sm:px-6 sm:pb-16 lg:grid-cols-[1.2fr_.8fr] lg:py-20 lg:pt-32">
        <div>
          <div className="flex flex-wrap gap-2">
            <MpPill>
              <Sparkles size={13} /> Creative Workspace
            </MpPill>
            <MpPill tone="purple">
              <Cpu size={13} /> Project Operator
            </MpPill>
          </div>
          <h1 className="mt-5 text-[clamp(2.7rem,8vw,5.8rem)] font-black leading-[0.88] tracking-[-0.04em]">
            Describe it.
            <br />
            <span className="hm-glow-green text-[var(--hm-green)]">LiTT builds it.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#c8c8da] sm:text-xl">
            LiTT is a complete building workspace — not a chatbot with a code box. You describe the site you want in
            plain words, and LiTT generates it, shows you a live preview, lets you edit by talking, checks the work,
            and publishes it to a real address.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              onClick={() => track("hero_cta_click", { source: "homepage_mockup_hero" })}
              className="hm-btn-primary flex items-center gap-2 rounded-full bg-[var(--hm-green)] px-6 py-3.5 font-black text-black"
            >
              Start Building <ArrowRight size={18} />
            </Link>
            <a
              href="#after-midnight"
              className="hm-btn-ghost flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 font-bold"
            >
              See After Midnight <MoonStar size={18} />
            </a>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-[var(--hm-green)]" /> No credit card to start
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-[var(--hm-green)]" /> Live preview
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-[var(--hm-green)]" /> 0 LiTTBits on failed builds
            </span>
          </div>
        </div>

        {/* Example workspace panel — a recorded preview of the Studio
            loop, labeled as an example (never presented as live). */}
        <div className="overflow-hidden rounded-3xl border border-white/15 bg-[#0b0b17] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex gap-1.5">
              <i className="h-3 w-3 rounded-full bg-red-400" />
              <i className="h-3 w-3 rounded-full bg-yellow-400" />
              <i className="h-3 w-3 rounded-full bg-[var(--hm-green)]" />
            </div>
            <span className="hm-mono text-[10px] uppercase tracking-widest text-zinc-400">LITT // EXAMPLE MISSION</span>
            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
              Recorded preview
            </span>
          </div>
          <div className="p-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="hm-mono text-[11px] text-zinc-400">YOU</p>
              <p className="mt-1 text-sm">
                “Make a moody, cinematic site for After Midnight — dark, neon, and easy to explore.”
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {[
                "Plan created — 6 sections, 2 flows",
                "Hero + story pages drafted",
                "Preview generated",
                "Checks passed — 14 / 14",
              ].map((s, i) => (
                <div
                  key={s}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 text-sm"
                >
                  <span className="flex gap-2">
                    <Check size={16} className="text-[var(--hm-green)]" />
                    {s}
                  </span>
                  <span className="hm-mono text-[10px] text-zinc-500">0{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-purple-500/10 p-3">
                <p className="text-xl font-black text-purple-300">14/14</p>
                <p className="text-[10px] text-zinc-400">CHECKS</p>
              </div>
              <div className="rounded-xl bg-[var(--hm-green)]/10 p-3">
                <p className="text-xl font-black text-[var(--hm-green)]">0</p>
                <p className="text-[10px] text-zinc-400">FAILED COST</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-xl font-black">READY</p>
                <p className="text-[10px] text-zinc-400">TO LAUNCH</p>
              </div>
            </div>
            <button
              onClick={() => setMission((m) => m + 1)}
              className="hm-btn-primary mt-4 w-full rounded-xl bg-white py-3 text-sm font-black text-black"
            >
              Continue mission {mission} →
            </button>
            <p className="mt-2 text-center text-[11px] text-zinc-500">
              Example workspace panel — recorded preview, not a live feed.
            </p>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1280px] px-4 pb-10 sm:px-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["6", "Plain steps", "One clear path from idea to launch"],
            ["1", "Workspace", "Everything in one connected place"],
            ["Every", "Build checked", "Quality is part of the loop"],
            ["0", "LiTTBits on failed build", "You only pay for work that lands"],
          ].map(([n, l, d]) => (
            <div key={l} className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-2xl font-black text-[var(--hm-green)] sm:text-3xl">{n}</p>
              <p className="mt-1 font-bold">{l}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AfterMidnightSection() {
  return (
    <section id="after-midnight" className="border-b border-white/10 bg-[#0a0a14]">
      <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[.9fr_1.1fr]">
          <div>
            <MpPill tone="purple">
              <MoonStar size={13} /> Concept page
            </MpPill>
            <h2 className="mt-4 text-[clamp(2rem,5vw,3.5rem)] font-black leading-none">
              After Midnight
              <br />
              <span className="text-purple-300">— a site, start to finish.</span>
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              Concept page — not a real artist release. Follow one idea as it becomes a complete, atmospheric site
              with story, visuals, and a launch-ready structure.
            </p>
            <Link
              href="/showcase/artist-launch-site"
              className="hm-btn-ghost mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 font-bold"
            >
              Open the case study <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="space-y-3">
            {[
              ["01", "The brief", "A late-night world. Cinematic, neon, a little haunted — and easy to explore."],
              ["02", "The direction", "Deep blacks, electric green, violet fog. Big type. Room to breathe."],
              ["03", "The build", "Story, visuals, navigation, and launch checks — shaped together, not bolted on."],
              ["04", "The result", "A site that feels like the world it describes — and is ready to share."],
            ].map(([n, t, d]) => (
              <div key={n} className="hm-card-hover flex gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                <span className="hm-mono text-2xl font-bold text-[var(--hm-green)]">{n}</span>
                <div>
                  <h3 className="font-bold">{t}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EverythingSection() {
  const cards = [
    {
      icon: <Wand2 />,
      t: "Design + engineering",
      d: "Look, feel, layout, and working code — designed and built as one thing.",
    },
    {
      icon: <Sparkles />,
      t: "Creative production",
      d: "Visual direction, copy, and story shaped around the world you are building.",
    },
    {
      icon: <Bot />,
      t: "Orchestration",
      d: "LiTT sequences the work, keeps dependencies clear, and moves the mission forward.",
    },
    {
      icon: <Database />,
      t: "Project memory",
      d: "Decisions, files, and context stay attached to the project — not scattered in chats.",
    },
    {
      icon: <FileCheck2 />,
      t: "Quality + control",
      d: "Checks, approvals, and review points before anything goes live.",
    },
    {
      icon: <Rocket />,
      t: "Files + launch",
      d: "Real files, real preview, real address. Publish when you are ready.",
    },
  ];
  return (
    <section className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 sm:py-20">
      <MpSectionHead
        kicker="Everything between idea and done"
        title={
          <>
            One workspace. <span className="text-[var(--hm-green)]">The whole job.</span>
          </>
        }
        copy="LiTT keeps the creative, technical, and operational work in the same loop — so nothing gets lost between tools."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <article key={c.t} className="hm-card-hover rounded-3xl border border-white/10 bg-[var(--hm-surface)] p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--hm-green)]/10 text-[var(--hm-green)]">
              {c.icon}
            </span>
            <h3 className="mt-4 text-xl font-bold">{c.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{c.d}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LoopSection() {
  const steps = [
    { icon: <Mic size={18} />, t: "Talk", d: "Describe the outcome in plain words." },
    { icon: <Sparkles size={18} />, t: "Create", d: "LiTT drafts direction, copy, and visuals." },
    { icon: <Check size={18} />, t: "Review", d: "You shape it by talking. Nothing is final until you say so." },
    { icon: <Code2 size={18} />, t: "Build", d: "The site becomes real files, not a screenshot." },
    { icon: <ShieldCheck size={18} />, t: "Check", d: "Every build is checked before it can ship." },
    { icon: <Rocket size={18} />, t: "Launch", d: "Publish to a real address. Export anytime." },
  ];
  return (
    <section className="border-y border-white/10 bg-gradient-to-br from-purple-900/30 via-[#0b0b17] to-[#04170f]">
      <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 sm:py-20">
        <MpSectionHead
          kicker="Brief in. Verified work out."
          title={<>Talk. Create. Build. Launch.</>}
          copy="A simple loop — with real checks and real control at every step."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, idx) => (
            <div key={s.t} className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <span className="hm-mono flex items-center justify-between text-xs text-[var(--hm-green)]">
                STEP 0{idx + 1}
                <span className="text-[var(--hm-green)]">{s.icon}</span>
              </span>
              <h3 className="mt-3 text-xl font-bold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-[var(--hm-green)]/30 bg-[var(--hm-green)]/5 p-6 sm:p-8">
            <h3 className="text-2xl font-black">Not a chat. A working system.</h3>
            <p className="mt-3 leading-relaxed text-zinc-300">
              Chats forget. Workspaces remember. LiTT turns conversation into plans, files, previews, checks, and
              launches — with a trail you can inspect.
            </p>
          </div>
          <div className="rounded-3xl border border-purple-400/30 bg-purple-500/10 p-6 sm:p-8">
            <h3 className="text-2xl font-black">One operator. The whole project loop.</h3>
            <p className="mt-3 leading-relaxed text-zinc-300">
              One operator keeps design, production, engineering, and launch moving together — so you stop being the
              glue between tools.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FastStartSection() {
  const [faq, setFaq] = useState(0);
  return (
    <section className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 sm:py-20">
      <MpSectionHead kicker="Fast start" title="From signup to first mission in minutes" />
      <ol className="mt-10 grid gap-3 md:grid-cols-5">
        {[
          "Create your workspace",
          "Describe your first idea",
          "Review the plan",
          "Preview the build",
          "Launch or keep shaping",
        ].map((s, i) => (
          <li key={s} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <span className="hm-mono text-2xl font-black text-purple-300">0{i + 1}</span>
            <p className="mt-3 font-bold leading-snug">{s}</p>
            <p className="mt-1 text-xs text-zinc-500">Step {i + 1} of 5</p>
          </li>
        ))}
      </ol>
      <div className="mt-10 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-3xl border border-white/10 bg-[var(--hm-surface)] p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-[var(--hm-green)]" />
            <h3 className="text-2xl font-black">Your work. Your control.</h3>
          </div>
          <ul className="mt-5 space-y-3">
            <MpCheckItem>Approvals before anything important ships.</MpCheckItem>
            <MpCheckItem>Export anytime — your files stay yours.</MpCheckItem>
            <MpCheckItem>Clear project memory, not a black box.</MpCheckItem>
            <MpCheckItem>0 LiTTBits charged on a failed build.</MpCheckItem>
          </ul>
        </div>
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#17112a] to-[#07130f] p-6 sm:p-8">
          <h3 className="text-2xl font-black">FAQ teaser</h3>
          <p className="mt-2 text-sm text-zinc-400">The short version — before you start building.</p>
          <div className="mt-5 space-y-2">
            {HOME_FAQS.map((f, i) => (
              <button
                key={f.q}
                onClick={() => setFaq(i)}
                aria-expanded={faq === i}
                className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                  faq === i
                    ? "border-[var(--hm-green)]/50 bg-[var(--hm-green)]/10"
                    : "border-white/10 bg-black/20 hover:border-white/25"
                }`}
              >
                <span className="flex justify-between gap-3">
                  {f.q}
                  <ChevronDown size={16} className={faq === i ? "rotate-180" : ""} />
                </span>
              </button>
            ))}
          </div>
          <p className="mt-4 rounded-xl bg-black/30 p-3 text-sm leading-relaxed text-zinc-300">{HOME_FAQS[faq].a}</p>
        </div>
      </div>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
      <div className="hm-noise relative overflow-hidden rounded-[2rem] border border-[var(--hm-green)]/30 bg-[#07130f] px-5 py-12 text-center sm:px-8 sm:py-16">
        <MpPill>Ready when you are</MpPill>
        <h2 className="mx-auto mt-5 max-w-3xl text-[clamp(2.1rem,6vw,4rem)] font-black leading-[0.95]">
          Your next project starts with one sentence.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-300">
          Describe it. Preview it. Shape it by talking. Launch it to a real address.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/sign-up"
            onClick={() => track("hero_cta_click", { source: "homepage_mockup_final_cta" })}
            className="hm-btn-primary rounded-full bg-[var(--hm-green)] px-7 py-3.5 font-black text-black"
          >
            Start Building — it’s free
          </Link>
          <Link
            href="/showcase/artist-launch-site"
            className="hm-btn-ghost rounded-full border border-white/25 px-7 py-3.5 font-bold"
          >
            Explore examples
          </Link>
        </div>
        <p className="hm-mono mt-5 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          No credit card required • Starter is free
        </p>
      </div>
    </section>
  );
}

function LandingPage() {
  return (
    <main id="main-content" className="litt-home-mockup min-h-dvh overflow-x-clip text-white">
      <HeroSection />
      <AfterMidnightSection />
      <EverythingSection />
      <LoopSection />
      <FastStartSection />
      <FinalCtaSection />
    </main>
  );
}

/* ============================================================
   CapabilityGrid — preserved verbatim from the previous
   homepage. It is imported by src/app/(marketing)/capabilities
   /page.tsx, so it stays exported from this module even though
   the homepage itself now renders the mockup's sections.
   ============================================================ */

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
    accent: "gold",
    size: "standard",
    points: ["Visual direction", "Branding", "Images and copy", "Audio concepts", "Campaign assets"],
  },
  {
    title: "Run real workflows",
    copy: "LiTT plans the mission, selects tools, edits the project, and keeps the work moving across code, files, terminal, research, and deployment.",
    eyebrow: "Orchestration",
    icon: Workflow,
    accent: "deep",
    size: "standard",
    points: ["Mission planning", "Tool routing", "Multi-step execution"],
  },
  {
    title: "Keep the context",
    copy: "Goals, decisions, files, and project history carry forward. Return tomorrow without rebuilding the entire conversation.",
    eyebrow: "Project memory",
    icon: BrainCircuit,
    accent: "gold",
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
    accent: "deep",
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
      <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#0E1510]">
        {title}
      </h2>
      <p className="mt-5 text-base leading-7 text-[#63745F] sm:text-lg sm:leading-8">{copy}</p>
    </div>
  );
}

export function CapabilityGrid() {
  return (
    <section id="what-we-do" className="litt-section relative overflow-hidden">
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
              <div className="mt-0.5 text-xs font-semibold text-[#63745F]">Core capabilities available in Studio</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[10px] font-black uppercase tracking-[0.14em]">
            <span className="rounded-full border border-[#E8A317]/45 bg-[#E8A317]/10 px-3 py-2 text-[#9A6B0F]">Voice · Terminal · Deploy <span className="text-[#63745F]">Beta</span></span>
            <Link href="/pricing" className="hidden items-center gap-1.5 text-[#63745F] transition hover:text-[#0C5A26] sm:inline-flex">
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
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#63745F]">{capability.eyebrow}</span>
                  </div>
                  <h3 className="mt-8 text-2xl font-black tracking-[-0.035em] text-[#0E1510]">{capability.title}</h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-[#63745F]">{capability.copy}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {capability.points.map((point) => (
                      <span key={point} className="litt-capability-tag inline-flex items-center gap-1.5 rounded-full border border-[#CFDEC4] bg-[#EDF3E4] px-2.5 py-1 text-[10px] font-bold text-[#37463A]">
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
