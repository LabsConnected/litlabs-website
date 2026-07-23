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
  Zap,
} from "lucide-react";

const powers = [
  { icon: Code2, label: "Build", copy: "Sites, apps, tools & automations" },
  { icon: Palette, label: "Create", copy: "Images, video, audio & ideas" },
  { icon: BrainCircuit, label: "Remember", copy: "Your projects, style & decisions" },
  { icon: Rocket, label: "Elevate", copy: "Review, improve & ship real work" },
];

const steps = [
  ["01", "Tell LiTT the mission", "Bring an idea, a problem, or a project already in motion."],
  ["02", "Your crew gets to work", "LiTT directs the plan while specialist agents create, code, research, and refine."],
  ["03", "You stay in command", "See the work, guide every decision, and ship when it feels right."],
];

const communityCards = [
  {
    eyebrow: "CREATOR WORLD",
    title: "Nova's Dream Lab",
    copy: "A living space for surreal art, music experiments, and friendly AI characters.",
    gradient: "from-[#a970ff]/45 via-[#101728] to-[#65f4ff]/20",
    accent: "#b58cff",
    meta: "18 creations · 4 collaborators",
  },
  {
    eyebrow: "REMIXABLE PROJECT",
    title: "Neon Garden",
    copy: "A tiny interactive world built in public—open it, play it, or make it your own.",
    gradient: "from-[#a8ff2f]/30 via-[#0b1710] to-[#65f4ff]/20",
    accent: "#a8ff2f",
    meta: "42 remixes · trending now",
  },
  {
    eyebrow: "COMMUNITY MISSION",
    title: "Build the Future",
    copy: "Creators, learners, and agents teaming up to turn one bold idea into something real.",
    gradient: "from-[#ff8a4c]/30 via-[#17100e] to-[#a970ff]/25",
    accent: "#ffad72",
    meta: "126 builders joined",
  },
];

const socialActions = [
  { icon: Heart, label: "Appreciate", copy: "Show love for what others create" },
  { icon: MessageCircle, label: "Comment", copy: "Leave feedback and ideas" },
  { icon: Save, label: "Save", copy: "Bookmark creations for later" },
  { icon: GitFork, label: "Remix", copy: "Fork any project and make it yours" },
  { icon: Users, label: "Collaborate", copy: "Join forces on shared projects" },
  { icon: Bot, label: "Ask LiTT", copy: "Learn how any creation was made" },
];

const ownershipPoints = [
  { icon: Shield, title: "You own your creations", copy: "Everything you build is yours. Export your content anytime—your data stays yours." },
  { icon: Zap, title: "Free to join, free to create", copy: "Your profile, community, and creative space will always have a free option." },
  { icon: Lock, title: "You control your privacy", copy: "Public, private, or friends-only. You decide who sees what." },
  { icon: Download, title: "Portable identity", copy: "Export your content and creations. No lock-in, ever." },
];

const marketplacePreview = [
  { name: "Code Architect", category: "Developer", price: "Free", color: "#818cf8", icon: Code2 },
  { name: "Visual Poet", category: "Design", price: "Free", color: "#ec4899", icon: Palette },
  { name: "Sound Forge", category: "Music", price: "Free", color: "#22d3ee", icon: Music },
  { name: "Research Owl", category: "Research", price: "Free", color: "#60a5fa", icon: BrainCircuit },
  { name: "Story Weaver", category: "Content", price: "Free", color: "#f472b6", icon: PenTool },
  { name: "Game Crafter", category: "Developer", price: "Free", color: "#fbbf24", icon: Gamepad2 },
];

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-cyan-300/10 bg-[#03050a]/78 shadow-[0_12px_50px_rgba(0,0,0,.35)] backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-black tracking-tight text-white">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 text-[#a8ff2f] shadow-[0_0_25px_rgba(168,255,47,.18)]">
            <Bot size={18} />
          </span>
          <span>LiTTree-LabStudios</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-white/60 md:flex">
          <a href="#discover" className="transition hover:text-[#a8ff2f]">Discover</a>
          <a href="#your-world" className="transition hover:text-[#a8ff2f]">Your world</a>
          <a href="#crew" className="transition hover:text-[#a8ff2f]">The crew</a>
          <a href="#how-it-works" className="transition hover:text-[#a8ff2f]">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden px-3 py-2 text-sm font-bold text-white/60 transition hover:text-white sm:block">
            Sign in
          </Link>
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#a8ff2f] to-[#62f6c4] px-4 py-2 text-sm font-black text-[#03050a] shadow-[0_0_28px_rgba(168,255,47,.2)] transition hover:scale-[1.03] hover:shadow-[0_0_38px_rgba(168,255,47,.35)]">
            Join free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#03050a] text-white selection:bg-[#a970ff] selection:text-white">
      <Header />

      <section className="relative min-h-[760px] border-b border-cyan-300/10 pt-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_35%,rgba(169,112,255,.25),transparent_32%),radial-gradient(circle_at_22%_24%,rgba(168,255,47,.14),transparent_27%),radial-gradient(circle_at_50%_100%,rgba(0,229,255,.08),transparent_35%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 py-16 lg:min-h-[760px] lg:grid-cols-[.92fr_1.08fr] lg:px-8 lg:py-20">
          <div className="relative z-10">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-xs font-black uppercase tracking-[.18em] text-[#a8ff2f]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#a8ff2f]" />
              Free creative social world · AI crew online
            </div>
            <h1 className="max-w-3xl text-5xl font-black leading-[.94] tracking-[-.055em] sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
              Your world.
              <span className="block">Your people.</span>
              <span className="mt-3 block bg-gradient-to-r from-[#a8ff2f] via-[#7efbff] to-[#a970ff] bg-clip-text text-transparent">
                Your AI crew.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-white/65">
              Build apps. Make art. Customize your space. Meet your people.
              LiTT and your creative AI crew help turn every idea into something real.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#a8ff2f] to-[#5df5d0] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:shadow-[0_0_55px_rgba(168,255,47,.38)]">
                Create your free space <ArrowRight size={16} />
              </Link>
              <a href="#discover" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold transition hover:border-[#a970ff]/60 hover:bg-white/10">
                <Play size={15} fill="currentColor" /> Explore the community
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/45">
              <span>✓ Free to join</span>
              <span>✓ 500 starter credits</span>
              <span>✓ No credit card</span>
              <span>✓ Your creations stay yours</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[680px]">
            <div className="absolute inset-10 rounded-full bg-[#a8ff2f]/20 blur-[90px]" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-black/40 shadow-[0_35px_100px_rgba(0,0,0,.65)]">
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
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-6 pb-6 pt-24">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[.22em] text-[#a8ff2f]">Crew 01 · LiTT</div>
                    <div className="mt-1 text-2xl font-black">LiTT</div>
                    <p className="mt-1 text-sm text-white/60">Plans the mission. Protects your vision. Keeps everything moving.</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#a8ff2f]">Online</span>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-4 rounded-2xl border border-white/15 bg-[#10120f]/90 p-4 shadow-2xl backdrop-blur-xl sm:-left-10">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#a970ff] text-black"><WandSparkles size={18} /></span>
                <div><div className="text-xs font-black">Ready for a mission</div><div className="text-[11px] text-white/45">Build · Create · Play · Elevate</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── DISCOVER ─── */}
      <section id="discover" className="relative border-b border-white/10 bg-[#05070d] px-5 py-20 text-white lg:px-8 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(101,244,255,.1),transparent_38%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">Discover what people are making</div>
              <h2 className="mt-4 max-w-4xl text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-6xl">
                Social media gave you a profile.
                <span className="mt-2 block text-white/45">LiTTree gives you a world.</span>
              </h2>
            </div>
            <p className="max-w-md text-lg leading-8 text-white/55">
              Share creations, meet collaborators, remix public projects, and grow a space that feels unmistakably yours.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {communityCards.map((card, index) => (
              <article key={card.title} className="group overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#090c13] transition duration-500 hover:-translate-y-2 hover:border-white/30">
                <div className={`relative flex min-h-64 items-end overflow-hidden bg-gradient-to-br ${card.gradient} p-6`}>
                  <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full border border-white/10 bg-white/5 transition duration-700 group-hover:scale-125" />
                  <div className="absolute right-8 top-8 grid h-16 w-16 place-items-center rounded-2xl border border-white/15 bg-black/25 text-2xl font-black backdrop-blur-md" style={{ color: card.accent }}>
                    {index === 0 ? "N" : index === 1 ? "✦" : "∞"}
                  </div>
                  <div className="relative">
                    <div className="text-[10px] font-black tracking-[.22em]" style={{ color: card.accent }}>{card.eyebrow}</div>
                    <h3 className="mt-2 text-3xl font-black">{card.title}</h3>
                  </div>
                </div>
                <div className="p-6">
                  <p className="leading-7 text-white/55">{card.copy}</p>
                  <div className="mt-6 border-t border-white/10 pt-4 text-xs font-bold uppercase tracking-wider text-white/35">{card.meta}</div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-5 rounded-2xl border border-[#a8ff2f]/20 bg-[#a8ff2f]/[.045] px-6 py-5 sm:flex-row">
            <p className="text-sm font-semibold text-white/65">
              Create · Share · Discover · Remix · Collaborate
            </p>
            <Link href="/sign-up" className="inline-flex items-center gap-2 text-sm font-black text-[#a8ff2f]">
              Start your LiTTree free <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── WHAT WE DO ─── */}
      <section id="what-we-do" className="relative border-b border-white/10 bg-[#060912] px-5 py-20 text-white lg:px-8 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_40%,rgba(0,229,255,.08),transparent_28%),radial-gradient(circle_at_85%_70%,rgba(169,112,255,.1),transparent_30%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">What LiTTree-LabStudios is for</div>
              <h2 className="mt-4 text-4xl font-black leading-none tracking-[-.045em] sm:text-6xl">Bring the idea.<br />We&apos;ll build the momentum.</h2>
            </div>
            <p className="max-w-xl text-lg leading-8 text-white/55 lg:justify-self-end">
              This is for creators, founders, learners, and curious people who want
              AI to do more than answer questions. Your crew helps you make, learn,
              experiment, and finish.
            </p>
          </div>
          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {powers.map(({ icon: Icon, label, copy }, index) => (
              <div key={label} className={`group relative min-h-56 overflow-hidden rounded-2xl border p-6 transition duration-300 hover:-translate-y-1 ${index % 2 === 0 ? "border-cyan-300/15 bg-cyan-300/[.035] hover:border-cyan-300/40 hover:shadow-[0_18px_60px_rgba(0,229,255,.1)]" : "border-violet-400/20 bg-violet-400/[.045] hover:border-violet-400/45 hover:shadow-[0_18px_60px_rgba(169,112,255,.12)]"}`}>
                <div className={`absolute -right-12 -top-12 h-28 w-28 rounded-full blur-3xl ${index % 2 === 0 ? "bg-cyan-300/10" : "bg-violet-400/10"}`} />
                <Icon size={26} className={index % 2 === 0 ? "text-[#65f4ff]" : "text-[#b58cff]"} />
                <div className="mt-14 text-3xl font-black">{label}</div>
                <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="crew" className="relative border-b border-white/10 bg-[#080a08] px-5 py-20 lg:px-8 lg:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(112,52,255,.14),transparent_45%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Meet the core crew</div>
              <h2 className="mt-4 max-w-2xl text-4xl font-black leading-none tracking-[-.045em] sm:text-6xl">Real characters.<br />Real roles. One mission.</h2>
            </div>
            <Link href="/agents" className="inline-flex items-center gap-2 text-sm font-black text-[#a970ff]">Explore all agents <ArrowRight size={15} /></Link>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <article className="group overflow-hidden rounded-[1.75rem] border border-[#a8ff2f]/20 bg-[#090d0b] shadow-[0_25px_80px_rgba(0,0,0,.4)] transition duration-500 hover:-translate-y-1 hover:border-[#a8ff2f]/45 hover:shadow-[0_28px_90px_rgba(168,255,47,.1)]">
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image src="/brand/litt-agent-hero-v2.png" alt="LiTT in the neon LiTTree creative command center" fill className="object-cover transition duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#11130f] via-transparent to-transparent" />
              </div>
              <div className="p-7">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a8ff2f]">Builder · Guide · Creator</div>
                <h3 className="mt-2 text-3xl font-black">LiTT</h3>
                <p className="mt-3 max-w-xl leading-7 text-white/55">Your always-there creative copilot. LiTT understands the goal, assembles the right tools, remembers the project, and helps turn the next idea into finished work.</p>
              </div>
            </article>
            <article className="group overflow-hidden rounded-[1.75rem] border border-[#a970ff]/25 bg-[#0b0910] shadow-[0_25px_80px_rgba(0,0,0,.4)] transition duration-500 hover:-translate-y-1 hover:border-[#a970ff]/55 hover:shadow-[0_28px_90px_rgba(169,112,255,.14)]">
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image src="/brand/spark-agent-hero-v2.png" alt="Spark, LiTT's neon robotic fox companion" fill className="object-cover transition duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#11130f] via-transparent to-transparent" />
              </div>
              <div className="p-7">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a970ff]">Companion · Explorer · Creative spark</div>
                <h3 className="mt-2 text-3xl font-black">Spark</h3>
                <p className="mt-3 max-w-xl leading-7 text-white/55">The playful side of the lab. Spark keeps discovery fun, helps you explore new directions, and brings personality, energy, and curiosity to every mission.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ─── YOUR WORLD ─── */}
      <section id="your-world" className="relative bg-[#050811] px-5 py-20 text-white lg:px-8 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(168,255,47,.04),transparent_35%,rgba(169,112,255,.06))]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-black shadow-[0_30px_100px_rgba(0,0,0,.55),0_0_60px_rgba(0,229,255,.07)]">
            <div className="relative aspect-[16/9]">
              <Image src="/brand/litt-base-station.png" alt="The LiTT Base Station creative command center" fill className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/25 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex max-w-xl flex-col justify-center p-7 sm:p-12">
                <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">The vision</div>
                <h2 className="mt-3 text-3xl font-black leading-tight text-white sm:text-5xl">Build your own LiTTree.</h2>
                <p className="mt-4 hidden max-w-md leading-7 text-white/60 sm:block">
                  Your style, projects, friends, agents, memories, music, and creations—all connected in one personal world that grows with you.
                </p>
                <div className="mt-6 hidden flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider text-white/55 sm:flex">
                  {["Custom themes", "Creator profile", "Projects", "Guestbook", "Your AI crew"].map((item) => (
                    <span key={item} className="rounded-full border border-white/15 bg-black/35 px-3 py-2 backdrop-blur-md">{item}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SOCIAL CREATION ─── */}
      <section className="relative border-b border-white/10 bg-[#050811] px-5 py-20 text-white lg:px-8 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(168,255,47,.04),transparent_35%,rgba(169,112,255,.06))]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#a970ff]">Social creation</div>
          <h2 className="mt-4 text-4xl font-black leading-none tracking-[-.045em] sm:text-6xl">Don&apos;t just like.<br />Remix.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/55">
            Every public creation can be appreciated, saved, remixed, or collaborated on.
            Remix is LiTTree&apos;s defining social action—fork any project and make it yours.
          </p>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {socialActions.map(({ icon: Icon, label, copy }) => (
              <div key={label} className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[.02] p-5 transition duration-300 hover:-translate-y-1 hover:border-[#a8ff2f]/25">
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

      {/* ─── MARKETPLACE PREVIEW ─── */}
      <section className="relative border-b border-white/10 bg-[#060912] px-5 py-20 lg:px-8 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(168,255,47,.06),transparent_35%),radial-gradient(circle_at_80%_50%,rgba(169,112,255,.06),transparent_35%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Marketplace</div>
              <h2 className="mt-4 text-4xl font-black leading-none tracking-[-.045em] sm:text-6xl">Free agents for every mission.</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/55">Browse community-built agents, themes, templates, and tools. Install what you need, or publish your own.</p>
            </div>
            <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm font-black text-[#a8ff2f]">Browse all agents <ArrowRight size={15} /></Link>
          </div>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {marketplacePreview.map(({ name, category, price, color, icon: Icon }) => (
              <Link key={name} href="/marketplace" className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.02] p-5 transition duration-300 hover:-translate-y-1 hover:border-[#a8ff2f]/25">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${color}20`, color }}>
                  <Icon size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black">{name}</div>
                  <div className="text-xs text-white/40">{category}</div>
                </div>
                <span className="shrink-0 rounded-full bg-[#a8ff2f]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#a8ff2f]">{price}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-white/10 bg-[#080a08] px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#a970ff]">How it works</div>
          <h2 className="mt-4 text-4xl font-black tracking-[-.045em] sm:text-6xl">You lead. Your crew delivers.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-3">
            {steps.map(([number, title, copy]) => (
              <div key={number} className="bg-[#0c0f0b] p-7 sm:p-9">
                <div className="font-mono text-xs font-black text-[#a8ff2f]">{number}</div>
                <h3 className="mt-10 text-2xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 8. OWNERSHIP & PRIVACY ─── */}
      <section className="relative border-y border-white/10 bg-[#080a08] px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Yours. Always.</div>
          <h2 className="mt-4 text-4xl font-black tracking-[-.045em] sm:text-6xl">You own it. You control it.</h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/55">
            Your profile, community, and creative space will always have a free option.
            No credit card to join. No lock-in. Your creations stay yours.
          </p>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ownershipPoints.map(({ icon: Icon, title, copy }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[.02] p-6">
                <Icon size={24} className="text-[#a8ff2f]" />
                <div className="mt-4 text-base font-black">{title}</div>
                <p className="mt-2 text-sm leading-6 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 9. FINAL FREE SIGNUP CTA ─── */}
      <section className="relative overflow-hidden border-y border-[#a8ff2f]/20 bg-[#060912] px-5 py-20 text-white lg:px-8 lg:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(168,255,47,.18),transparent_30%),radial-gradient(circle_at_85%_65%,rgba(169,112,255,.22),transparent_34%)]" />
        <div className="absolute -right-16 -top-20 text-[22rem] font-black leading-none text-white/[.025]">L</div>
        <div className="relative mx-auto flex max-w-7xl flex-col justify-between gap-10 lg:flex-row lg:items-end">
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Free to join · No credit card required</div>
            <h2 className="mt-3 max-w-4xl text-5xl font-black leading-[.95] tracking-[-.05em] sm:text-7xl">Build it. Create it.<br /><span className="bg-gradient-to-r from-[#a8ff2f] via-[#65f4ff] to-[#b58cff] bg-clip-text font-serif italic font-normal text-transparent">Make it unforgettable.</span></h2>
            <div className="mt-6 flex items-center gap-3 text-sm text-white/50"><span className="h-2 w-2 animate-pulse rounded-full bg-[#a8ff2f] shadow-[0_0_16px_#a8ff2f]" /> Start with 500 credits. Your crew is waiting.</div>
          </div>
          <Link href="/sign-up" className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#a8ff2f]/40 bg-[#a8ff2f] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:border-[#b58cff] hover:bg-[#b58cff] hover:shadow-[0_0_50px_rgba(169,112,255,.28)]">
            Create your free space <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="bg-[#050706] px-5 py-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-xs text-white/35 sm:flex-row">
          <div className="flex items-center gap-2 font-black text-white"><Sparkles size={14} className="text-[#a8ff2f]" /> LiTTree-LabStudios</div>
          <div>Build · Create · Have fun · Elevate</div>
          <div className="flex gap-5"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
      </footer>
    </main>
  );
}

export default function HomePage() {
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
