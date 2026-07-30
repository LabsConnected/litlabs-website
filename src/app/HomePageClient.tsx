"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Code2,
  Palette,
  Play,
  Rocket,
  Sparkles,
  WandSparkles,
  Users,
  Heart,
  MessageCircle,
  Save,
  GitFork,
  Music,
  Gamepad2,
  PenTool,
  Shield,
  Lock,
  Download,
  BookOpen,
  Check,
} from "lucide-react";

/* ── Data ──────────────────────────────────────────────────────── */

const buildCards = [
  { icon: Code2, label: "Build", copy: "Sites, apps, tools, prototypes, automations, and interactive experiences." },
  { icon: Palette, label: "Create", copy: "Images, branding, music, video concepts, stories, and campaigns." },
  { icon: BookOpen, label: "Learn", copy: "Understand code, explore ideas, practice new skills, and ask questions inside your actual project." },
  { icon: Rocket, label: "Launch", copy: "Review the work, fix problems, prepare previews, and move projects toward release." },
];

const memoryTimeline = ["Idea", "Decisions", "Files", "Revisions", "Launch"];

const socialActions = [
  { icon: Heart, label: "Appreciate", copy: "Show love for what others create" },
  { icon: MessageCircle, label: "Comment", copy: "Leave feedback and ideas" },
  { icon: Save, label: "Save", copy: "Bookmark creations for later" },
  { icon: GitFork, label: "Remix", copy: "Fork any project and make it yours" },
  { icon: Users, label: "Collaborate", copy: "Join forces on shared projects" },
];

const ownershipPoints = [
  { icon: Shield, title: "You own your creations", copy: "Everything you build is yours. Export your content anytime." },
  { icon: Lock, title: "Control who can see them", copy: "Public, private, or friends-only. You decide who sees what." },
  { icon: Download, title: "Export your work", copy: "Take your content and creations with you. No lock-in." },
  { icon: Sparkles, title: "Keep a free creative space", copy: "Your profile, community, and creative space will always have a free option." },
];

const marketplacePreview = [
  { name: "Code Architect", category: "Developer", color: "#818cf8", icon: Code2 },
  { name: "Visual Director", category: "Design", color: "#ec4899", icon: Palette },
  { name: "Sound Forge", category: "Music", color: "#22d3ee", icon: Music },
  { name: "Research Guide", category: "Research", color: "#60a5fa", icon: BrainCircuit },
  { name: "Story Builder", category: "Content", color: "#f472b6", icon: PenTool },
  { name: "Game Designer", category: "Developer", color: "#fbbf24", icon: Gamepad2 },
];

const howItWorks = [
  ["01", "Describe the outcome", "Start with an idea, a problem, or an existing project."],
  ["02", "Build alongside your crew", "LiTT organizes the work while the right creative and technical tools help produce it."],
  ["03", "Review and direct", "See what is happening, approve important actions, and change direction anytime."],
  ["04", "Save, share, or launch", "Keep it private, publish it, invite collaborators, or ship it."],
];

/* ── Navigation ────────────────────────────────────────────────── */

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-[#03050a]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-5 lg:px-10">
        <Link href="/" className="flex items-center gap-2.5 font-black tracking-tight text-white">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 text-[#a8ff2f] shadow-[0_0_25px_rgba(168,255,47,.18)]">
            <Bot size={18} />
          </span>
          <span>LiTTree LabStudios</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-white/60 md:flex">
          <a href="#explore" className="transition hover:text-[#a8ff2f]">Explore</a>
          <Link href="/studio" className="transition hover:text-[#a8ff2f]">Studio</Link>
          <Link href="/discover" className="transition hover:text-[#a8ff2f]">Community</Link>
          <Link href="/marketplace" className="transition hover:text-[#a8ff2f]">Marketplace</Link>
          <a href="#how-it-works" className="transition hover:text-[#a8ff2f]">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden px-3 py-2 text-sm font-bold text-white/60 transition hover:text-white sm:block">
            Sign in
          </Link>
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-[#a8ff2f] to-[#62f6c4] px-4 py-2 text-sm font-black text-[#03050a] shadow-[0_0_28px_rgba(168,255,47,.2)] transition hover:scale-[1.03] hover:shadow-[0_0_38px_rgba(168,255,47,.35)]">
            Start free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#03050a] text-white selection:bg-[#a970ff] selection:text-white">
      <Header />

      {/* ═══ 1. HERO ═══ */}
      <section className="relative min-h-190 border-b border-white/8 pt-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_35%,rgba(169,112,255,.22),transparent_32%),radial-gradient(circle_at_22%_24%,rgba(168,255,47,.12),transparent_27%),radial-gradient(circle_at_50%_100%,rgba(0,229,255,.06),transparent_35%)]" />
        <div className="absolute inset-0 opacity-15 bg-[linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] bg-size-[64px_64px]" />
        <div className="relative mx-auto grid max-w-screen-2xl items-center gap-12 px-5 py-16 lg:min-h-190 lg:grid-cols-[1fr_0.85fr] lg:px-10 lg:py-20">
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
              <Link href="/sign-up" className="inline-flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-[#a8ff2f] to-[#5df5d0] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:shadow-[0_0_55px_rgba(168,255,47,.38)]">
                Start creating free <ArrowRight size={16} />
              </Link>
              <Link href="/studio?demo=1" data-testid="cta-try-demo" className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-300/10 px-6 py-4 text-sm font-black text-amber-200 transition hover:-translate-y-1 hover:border-amber-300/70 hover:bg-amber-300/15">
                <Play size={15} fill="currentColor" /> Try Studio without signing in
              </Link>
              <a href="#explore" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold transition hover:border-[#a970ff]/60 hover:bg-white/10">
                Explore what people are building
              </a>
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
                <div><div className="text-xs font-black">Ready for a mission</div><div className="text-[11px] text-white/45">Build · Create · Learn · Launch</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 2. STUDIO DEMONSTRATION ═══ */}
      <section className="relative border-b border-white/8 bg-[#05070d] px-5 py-20 text-white lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(101,244,255,.08),transparent_38%)]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              One place to think, build, create, and finish.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55">
              LiTT keeps your conversations, files, projects, creative direction,
              and tools connected—so every session starts where the last one ended.
            </p>
          </div>

          {/* Studio screenshot with callouts */}
          <div className="relative mt-14 overflow-hidden rounded-3xl border border-white/12 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55)]">
            <div className="relative aspect-video">
              <Image src="/brand/litt-base-station.png" alt="LiTTree Studio command center interface" fill className="object-cover" priority />
              <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />
            </div>
          </div>

          {/* Three callouts */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { icon: MessageCircle, title: "Talk naturally", copy: "Describe what you want in plain language. LiTT understands the goal." },
              { icon: Code2, title: "Build real projects", copy: "Code, assets, and files are created and organized as you go." },
              { icon: BrainCircuit, title: "Keep project memory", copy: "Decisions, style, and context carry forward across every session." },
            ].map(({ icon: Icon, title, copy }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/3 p-6">
                <Icon size={22} className="text-[#a8ff2f]" />
                <div className="mt-4 text-base font-black">{title}</div>
                <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 3. MEET LiTT AND SPARK ═══ */}
      <section id="crew" className="relative border-b border-white/8 bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(112,52,255,.12),transparent_45%)]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Your idea. Your crew. Your direction.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {/* LiTT */}
            <article className="group overflow-hidden rounded-[1.75rem] border border-[#a8ff2f]/20 bg-[#090d0b] shadow-[0_25px_80px_rgba(0,0,0,.4)] transition duration-500 hover:-translate-y-1 hover:border-[#a8ff2f]/45">
              <div className="relative aspect-16/10 overflow-hidden">
                <Image src="/brand/litt-agent-hero-v2.png" alt="LiTT in the neon LiTTree creative command center" fill className="object-cover transition duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-linear-to-t from-[#11130f] via-transparent to-transparent" />
              </div>
              <div className="p-7">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a8ff2f]">Builder · Operator · Guide</div>
                <h3 className="mt-2 text-3xl font-black">LiTT</h3>
                <p className="mt-3 max-w-xl leading-7 text-white/55">
                  LiTT understands the mission, keeps the project organized, chooses
                  the right tools, and helps move the work toward completion.
                </p>
              </div>
            </article>
            {/* Spark */}
            <article className="group overflow-hidden rounded-[1.75rem] border border-[#a970ff]/25 bg-[#0b0910] shadow-[0_25px_80px_rgba(0,0,0,.4)] transition duration-500 hover:-translate-y-1 hover:border-[#a970ff]/55">
              <div className="relative aspect-16/10 overflow-hidden">
                <Image src="/brand/spark-agent-hero-v2.png" alt="Spark, LiTT's neon robotic fox companion" fill className="object-cover transition duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-linear-to-t from-[#11130f] via-transparent to-transparent" />
              </div>
              <div className="p-7">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a970ff]">Explorer · Creative Partner · Challenger</div>
                <h3 className="mt-2 text-3xl font-black">Spark</h3>
                <p className="mt-3 max-w-xl leading-7 text-white/55">
                  Spark brings fresh directions, playful ideas, visual energy, and
                  the creative push that keeps projects from becoming ordinary.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ═══ 4. BUILD / CREATE / LEARN / LAUNCH ═══ */}
      <section id="what-we-do" className="relative border-b border-white/8 bg-[#060912] px-5 py-20 text-white lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_40%,rgba(0,229,255,.06),transparent_28%),radial-gradient(circle_at_85%_70%,rgba(169,112,255,.08),transparent_30%)]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Make more than content.
              <span className="mt-2 block text-white/45">Build something that works.</span>
            </h2>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {buildCards.map(({ icon: Icon, label, copy }, index) => (
              <div
                key={label}
                className={`group relative min-h-52 overflow-hidden rounded-2xl border p-6 transition duration-300 hover:-translate-y-1 ${
                  index % 2 === 0
                    ? "border-cyan-300/15 bg-cyan-300/[.03] hover:border-cyan-300/40"
                    : "border-violet-400/20 bg-violet-400/[.04] hover:border-violet-400/45"
                }`}
              >
                <div className={`absolute -right-12 -top-12 h-28 w-28 rounded-full blur-3xl ${index % 2 === 0 ? "bg-cyan-300/8" : "bg-violet-400/8"}`} />
                <Icon size={26} className={index % 2 === 0 ? "text-[#65f4ff]" : "text-[#b58cff]"} />
                <div className="mt-12 text-2xl font-black">{label}</div>
                <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 5. PROJECT MEMORY ═══ */}
      <section className="relative border-b border-white/8 bg-[#050811] px-5 py-20 text-white lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(168,255,47,.04),transparent_35%,rgba(169,112,255,.06))]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">The memory advantage</div>
            <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              LiTT remembers the work—
              <span className="block text-white/45">not just the chat.</span>
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55">
              Your project decisions, style, goals, constraints, and progress stay
              connected. Return tomorrow and keep moving instead of explaining
              everything again.
            </p>
          </div>

          {/* Timeline */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
            {memoryTimeline.map((step, i) => (
              <div key={step} className="flex items-center gap-2 sm:gap-4">
                <div className={`rounded-xl border px-5 py-3 text-sm font-black ${i === 0 ? "border-[#a8ff2f]/40 bg-[#a8ff2f]/10 text-[#a8ff2f]" : i === memoryTimeline.length - 1 ? "border-[#a970ff]/40 bg-[#a970ff]/10 text-[#b58cff]" : "border-white/12 bg-white/3 text-white/70"}`}>
                  {step}
                </div>
                {i < memoryTimeline.length - 1 && (
                  <ArrowRight size={18} className="shrink-0 text-white/25" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 6. SOCIAL CREATION ═══ */}
      <section id="explore" className="relative border-b border-white/8 bg-[#050811] px-5 py-20 text-white lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(168,255,47,.04),transparent_35%,rgba(169,112,255,.06))]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Share the result. Remix the idea.
              <span className="block text-white/45">Build together.</span>
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55">
              Publish projects, discover creators, save ideas, remix public work,
              and invite people into shared creations.
            </p>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {socialActions.map(({ icon: Icon, label, copy }) => (
              <div key={label} className="group flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/2 p-5 transition duration-300 hover:-translate-y-1 hover:border-[#a8ff2f]/25">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#a8ff2f]/10 text-[#a8ff2f]">
                  <Icon size={18} />
                </span>
                <div>
                  <div className="text-sm font-black">{label}</div>
                  <p className="mt-1 text-xs leading-5 text-white/45">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 7. REAL CREATOR EXAMPLES ═══ */}
      <section className="relative border-b border-white/8 bg-[#060912] px-5 py-20 text-white lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(168,255,47,.05),transparent_35%),radial-gradient(circle_at_70%_50%,rgba(169,112,255,.05),transparent_35%)]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">Built inside LiTTree</div>
            <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Real projects from real creators.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/55">
              These are concept examples of what the platform is designed for.
              As creators publish, this section will feature real work.
            </p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              { title: "Nova's Dream Lab", creator: "@nova", built: "Surreal art gallery + music experiments", tools: "Image · Audio · Canvas", accent: "#b58cff" },
              { title: "Neon Garden", creator: "@garden", built: "Interactive remixable world", tools: "Code · Canvas · 3D", accent: "#a8ff2f" },
              { title: "Build the Future", creator: "@futurecrew", built: "Community mission for bold ideas", tools: "Workflows · Chat · Docs", accent: "#ffad72" },
            ].map((project) => (
              <article key={project.title} className="group overflow-hidden rounded-[1.5rem] border border-white/12 bg-[#090c13] transition duration-500 hover:-translate-y-2 hover:border-white/30">
                <div className="relative flex min-h-48 items-end overflow-hidden bg-linear-to-br from-white/5 to-transparent p-6">
                  <div className="absolute right-6 top-6 grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-black/25 text-xl font-black backdrop-blur-md" style={{ color: project.accent }}>
                    {project.title[0]}
                  </div>
                  <div>
                    <h3 className="text-2xl font-black">{project.title}</h3>
                    <div className="mt-1 text-xs font-bold text-white/40">{project.creator}</div>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-sm leading-6 text-white/55">{project.built}</p>
                  <div className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/35">{project.tools}</div>
                  <div className="mt-5 flex gap-2">
                    <Link href="/sign-up" className="flex-1 rounded-lg border border-white/15 py-2 text-center text-xs font-bold text-white/70 transition hover:bg-white/5">Open Project</Link>
                    <Link href="/sign-up" className="flex-1 rounded-lg border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 py-2 text-center text-xs font-bold text-[#a8ff2f] transition hover:bg-[#a8ff2f]/15">Remix</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 8. MARKETPLACE ═══ */}
      <section className="relative border-b border-white/8 bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(168,255,47,.05),transparent_35%),radial-gradient(circle_at_80%_50%,rgba(169,112,255,.05),transparent_35%)]" />
        <div className="relative mx-auto max-w-screen-2xl">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Marketplace</div>
              <h2 className="mt-4 max-w-2xl text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
                Add new skills when the mission needs them.
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/55">
                Install community agents, templates, themes, and tools—or publish
                your own for other creators.
              </p>
            </div>
            <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm font-black text-[#a8ff2f]">Browse marketplace <ArrowRight size={15} /></Link>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {marketplacePreview.map(({ name, category, color, icon: Icon }) => (
              <Link key={name} href="/marketplace" className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/2 p-5 transition duration-300 hover:-translate-y-1 hover:border-[#a8ff2f]/25">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${color}20`, color }}>
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
        </div>
      </section>

      {/* ═══ 9. HOW IT WORKS ═══ */}
      <section id="how-it-works" className="border-y border-white/8 bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              You lead. LiTT keeps the momentum.
            </h2>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
            {howItWorks.map(([number, title, copy]) => (
              <div key={number} className="bg-[#0c0f0b] p-7 sm:p-8">
                <div className="font-mono text-xs font-black text-[#a8ff2f]">{number}</div>
                <h3 className="mt-8 text-xl font-black">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 10. OWNERSHIP & PRIVACY ═══ */}
      <section className="relative border-y border-white/8 bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Your work. Your identity. Your rules.
            </h2>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ownershipPoints.map(({ icon: Icon, title, copy }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/2 p-6">
                <Icon size={24} className="text-[#a8ff2f]" />
                <div className="mt-4 text-base font-black">{title}</div>
                <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 11. FINAL CTA ═══ */}
      <section className="relative overflow-hidden border-y border-[#a8ff2f]/20 bg-[#060912] px-5 py-20 text-white lg:px-10 lg:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(168,255,47,.16),transparent_30%),radial-gradient(circle_at_85%_65%,rgba(169,112,255,.2),transparent_34%)]" />
        <div className="absolute -right-16 -top-20 text-[22rem] font-black leading-none text-white/[0.025]">L</div>
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
            <Link href="/sign-up" className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:bg-[#b8ff5f] hover:shadow-[0_0_50px_rgba(168,255,47,.35)]">
              Start creating free <ArrowRight size={16} />
            </Link>
            <Link href="/studio?demo=1" className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold text-white transition hover:border-white/30 hover:bg-white/10">
              <Play size={14} fill="currentColor" /> Try the Studio
            </Link>
            <div className="mt-1 text-xs font-semibold text-white/40">500 starter credits · No credit card required</div>
          </div>
        </div>
      </section>

      {/* ═══ 12. FOOTER ═══ */}
      <footer className="bg-[#050706] px-5 py-8 lg:px-10">
        <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 text-xs text-white/35 sm:flex-row">
          <div className="flex items-center gap-2 font-black text-white"><Sparkles size={14} className="text-[#a8ff2f]" /> LiTTree LabStudios</div>
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
      </footer>
    </main>
  );
}

export default function HomePageClient() {
  const { isSignedIn: clerkSignedIn, isLoaded: clerkLoaded } = useClerkAuth();
  const { isSignedIn: supabaseSignedIn, loading: supabaseLoading } =
    useSupabaseAuthHook();
  const router = useRouter();

  useEffect(() => {
    if (!clerkLoaded || supabaseLoading) return;
    if (clerkSignedIn || supabaseSignedIn) router.replace("/studio");
  }, [clerkSignedIn, supabaseSignedIn, clerkLoaded, supabaseLoading, router]);

  return <LandingPage />;
}
