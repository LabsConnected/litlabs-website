"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  Code2,
  Palette,
  Play,
  Rocket,
  Shield,
  Sparkles,
  Users,
  WandSparkles,
} from "lucide-react";

/* ── Asset Inventory ───────────────────────────────────────────── */
const ASSET_INVENTORY = [
  { path: "/brand/litt-alive.mp4", type: "Video", used: "Hero — LiTT comes to life" },
  { path: "/brand/litt-alive-poster.webp", type: "Image", used: "Hero — reduced-motion poster" },
  { path: "/brand/litt-base-station.png", type: "Image", used: "Studio demo screenshot" },
  { path: "/brand/litt-agent-hero-v2.png", type: "Image", used: "LiTT agent card" },
  { path: "/brand/spark-agent-hero-v2.png", type: "Image", used: "Spark agent card" },
  { path: "/brand/litt-mascot-avatar.png", type: "Image", used: "LiTT avatar / favicon" },
  { path: "/brand/litt-mascot-hero.png", type: "Image", used: "LiTT full hero (unused — candidate)" },
  { path: "/brand/spark-agent-portrait.png", type: "Image", used: "Spark portrait (unused — candidate)" },
];

/* ── Section Order ─────────────────────────────────────────────── */
const SECTION_ORDER = [
  { id: "hero", label: "Hero", status: "wireframe" },
  { id: "mission-demo", label: "Mission Demo", status: "placeholder" },
  { id: "studio-proof", label: "Studio Proof", status: "wireframe" },
  { id: "dashboard-proof", label: "Dashboard Proof", status: "placeholder" },
  { id: "showcase", label: "Real Showcase", status: "placeholder" },
  { id: "marketplace", label: "Marketplace", status: "wireframe" },
  { id: "how-it-works", label: "How It Works", status: "wireframe" },
  { id: "ownership", label: "Ownership & Trust", status: "wireframe" },
  { id: "cta", label: "Final CTA", status: "wireframe" },
  { id: "footer", label: "Footer", status: "wireframe" },
];

/* ── Checkpoint Banner ────────────────────────────────────────── */
function CheckpointBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-400/30 bg-amber-950/90 px-4 py-2 text-center text-xs font-semibold text-amber-200 backdrop-blur-xl">
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        Checkpoint 1 — Wireframe &amp; Section Order · /preview/landing-v2 · Not indexed
      </span>
    </div>
  );
}

/* ── Section Order Sidebar ────────────────────────────────────── */
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

/* ── Asset Inventory Panel ────────────────────────────────────── */
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

/* ── Wireframe Section Wrapper ────────────────────────────────── */
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

/* ── Hero (Desktop + Mobile) ──────────────────────────────────── */
function Hero() {
  return (
    <WireframeSection id="hero" label="01 · Hero" className="min-h-screen pt-16">
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
              <div><div className="text-xs font-black">Ready for a mission</div><div className="text-[11px] text-white/45">Build · Create · Learn · Launch</div></div>
            </div>
          </div>
        </div>
      </div>
    </WireframeSection>
  );
}

/* ── Mission Demo (placeholder) ───────────────────────────────── */
function MissionDemoPlaceholder() {
  return (
    <WireframeSection id="mission-demo" label="02 · Mission Demo" className="bg-[#05070d] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">Checkpoint 2</div>
        <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] text-white/40 sm:text-5xl">
          Watch LiTT build a launch page.
        </h2>
        <p className="mt-5 text-lg leading-8 text-white/30">
          A live mission animation will show: natural-language command → planning →
          branding → copywriting → files → preview → approval → deployment prep.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-4">
          {["Command", "Plan", "Build", "Approve"].map((step, i) => (
            <div key={step} className="rounded-2xl border border-dashed border-white/10 bg-white/2 p-6 text-center">
              <div className="font-mono text-xs text-white/20">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-3 text-sm font-bold text-white/40">{step}</div>
            </div>
          ))}
        </div>
      </div>
    </WireframeSection>
  );
}

/* ── Studio Proof ─────────────────────────────────────────────── */
function StudioProof() {
  return (
    <WireframeSection id="studio-proof" label="03 · Studio Proof" className="bg-[#05070d] px-5 py-20 text-white lg:px-10 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
          One place to think, build, create, and finish.
        </h2>
        <p className="mt-5 text-lg leading-8 text-white/55">
          LiTT keeps your conversations, files, projects, creative direction,
          and tools connected—so every session starts where the last one ended.
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

/* ── Dashboard Proof (placeholder) ────────────────────────────── */
function DashboardProofPlaceholder() {
  return (
    <WireframeSection id="dashboard-proof" label="04 · Dashboard Proof" className="bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
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

/* ── Showcase (placeholder) ───────────────────────────────────── */
function ShowcasePlaceholder() {
  return (
    <WireframeSection id="showcase" label="05 · Real Showcase" className="bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
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

/* ── Marketplace ──────────────────────────────────────────────── */
function Marketplace() {
  const agents = [
    { name: "LiTT Growth", category: "Marketing", color: "#a8ff2f", icon: Rocket },
    { name: "LiTT Social", category: "Content", color: "#ec4899", icon: Users },
    { name: "LiTT Coder Pro", category: "Developer", color: "#818cf8", icon: Code2 },
  ];
  return (
    <WireframeSection id="marketplace" label="06 · Marketplace" className="bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto max-w-screen-2xl">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Marketplace</div>
            <h2 className="mt-4 max-w-2xl text-4xl font-black leading-[.98] tracking-[-.045em] text-white sm:text-5xl">
              Add new skills when the mission needs them.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/55">
              Install community agents, templates, themes, and tools—or publish
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

/* ── How It Works ─────────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    ["01", "Describe the outcome", "Start with an idea, a problem, or an existing project."],
    ["02", "Build alongside your crew", "LiTT organizes the work while the right creative and technical tools help produce it."],
    ["03", "Review and direct", "See what is happening, approve important actions, and change direction anytime."],
    ["04", "Save, share, or launch", "Keep it private, publish it, invite collaborators, or ship it."],
  ];
  return (
    <WireframeSection id="how-it-works" label="07 · How It Works" className="bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
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

/* ── Ownership & Trust ────────────────────────────────────────── */
function Ownership() {
  const points = [
    { icon: Shield, title: "You own your creations", copy: "Everything you build is yours. Export your content anytime." },
    { icon: Sparkles, title: "Keep a free creative space", copy: "Your profile, community, and creative space will always have a free option." },
    { icon: Palette, title: "Control who can see them", copy: "Public, private, or friends-only. You decide who sees what." },
    { icon: Rocket, title: "Export your work", copy: "Take your content and creations with you. No lock-in." },
  ];
  return (
    <WireframeSection id="ownership" label="08 · Ownership & Trust" className="bg-[#080a08] px-5 py-20 lg:px-10 lg:py-28">
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

/* ── Final CTA ────────────────────────────────────────────────── */
function FinalCTA() {
  return (
    <WireframeSection id="cta" label="09 · Final CTA" className="overflow-hidden bg-[#060912] px-5 py-20 text-white lg:px-10 lg:py-24">
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
          <div className="mt-1 text-xs font-semibold text-white/40">500 starter credits · No credit card required</div>
        </div>
      </div>
    </WireframeSection>
  );
}

/* ── Footer ───────────────────────────────────────────────────── */
function Footer() {
  return (
    <WireframeSection id="footer" label="10 · Footer" className="bg-[#050706] px-5 py-8 lg:px-10">
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

/* ── Page ─────────────────────────────────────────────────────── */
export default function LandingV2Client() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#03050a] text-white selection:bg-[#a970ff] selection:text-white">
      <CheckpointBanner />
      <Hero />
      <MissionDemoPlaceholder />
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
