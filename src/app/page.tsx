"use client";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  Zap,
  Sparkles,
  Bot,
  Code,
  Share2,
  Shield,
  ArrowRight,
  Users,
  Globe,
  MessageCircle,
  Play,
  CheckCircle,
  Loader2,
  ChevronDown,
  Image as ImageIcon,
  Video,
  Mic,
  LayoutDashboard,
  MessageSquare,
  ShoppingBag,
} from "lucide-react";

// Dashboard imports (lazy loaded when signed in)
import dynamicImport from "next/dynamic";
const DashboardView = dynamicImport(
  () => import("@/components/DashboardView"),
  {
    loading: () => (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#0a0a12" }}
      >
        <Loader2 className="animate-spin text-cyan-400" size={32} />
      </div>
    ),
    ssr: false,
  },
);

// Theme colors
const C = {
  bgColor: "#0a0a12",
  boxBg: "rgba(255,255,255,0.03)",
  borderColor: "rgba(255,255,255,0.1)",
  textColor: "#e0e0e0",
  textMuted: "rgba(255,255,255,0.7)",
  headerColor: "#00f0ff",
  accentColor: "#ff00a0",
  linkColor: "#ff9ff3",
  success: "#00ff41",
};

// Landing Page Component
function LandingPage() {
  const features = [
    {
      icon: Bot,
      title: "AI Agents as Your Co-Pilots",
      desc: "Bring autonomous agents into your creative workflow. They code, write, remix, and publish alongside you.",
      color: C.headerColor,
    },
    {
      icon: Code,
      title: "A Creator Network for Builders",
      desc: "Share projects, discover creators, and build in public. Your workspace is connected to a network of makers.",
      color: C.accentColor,
    },
    {
      icon: Share2,
      title: "Social Distribution, On Autopilot",
      desc: "Cross-post to your channels, grow your audience, and let agents help your work travel farther.",
      color: C.linkColor,
    },
    {
      icon: Shield,
      title: "Freedom & Ownership",
      desc: "Your content, your agents, your data. No lock-in. No algorithms you don't control. Build on your terms.",
      color: C.success,
    },
  ];

  const useCases = [
    {
      name: "Builders & Makers",
      desc: "Turn ideas into projects with agents at your side",
      icon: Zap,
    },
    {
      name: "Digital Artists",
      desc: "Create, remix, and share with AI-powered tools",
      icon: MessageCircle,
    },
    {
      name: "Dev Crews",
      desc: "Ship faster together with code agents",
      icon: Code,
    },
    {
      name: "Community Leaders",
      desc: "Grow and engage your people at scale",
      icon: Users,
    },
  ];

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: C.bgColor, color: C.textColor }}
    >
      {/* Hero Section */}
      <section className="relative pt-20 pb-16 lg:pt-28 lg:pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-left">
              <div
                className="inline-flex items-center gap-2 px-3 py-1 mb-6 border text-xs font-mono"
                style={{ borderColor: C.borderColor, color: C.headerColor }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                NOW IN PUBLIC BETA
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight mb-6 tracking-tight">
                The Creator Network
                <span style={{ color: C.headerColor }}> With AI Agents</span>
              </h1>

              <p
                className="text-lg sm:text-xl mb-8 max-w-xl mx-auto lg:mx-0"
                style={{ color: C.textMuted }}
              >
                Build, share, and grow — with agents at your side. LiTTree is a
                new space for creators where AI helps you create, connect, and
                distribute your work.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Link
                  href="/sign-up"
                  className="group inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold border-2 hover:opacity-80 transition-all"
                  style={{ borderColor: C.headerColor, color: C.headerColor }}
                >
                  Start Building Free
                  <ArrowRight
                    size={18}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </Link>
                <Link
                  href="/studio"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-medium border hover:bg-white/5 transition-all"
                  style={{ borderColor: C.borderColor }}
                >
                  <Play size={18} />
                  Try Studio
                </Link>
              </div>

              <div
                className="mt-8 flex items-center gap-6 justify-center lg:justify-start text-sm"
                style={{ color: C.textMuted }}
              >
                <span className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-400" />
                  Free tier available
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-400" />
                  No credit card required
                </span>
              </div>
            </div>

            {/* Hero Visual */}
            <div className="relative">
              {/* Desktop terminal */}
              <div
                className="hidden md:block relative border-2 p-6"
                style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              >
                {/* Fake terminal */}
                <div
                  className="flex items-center gap-2 mb-4 pb-4 border-b"
                  style={{ borderColor: C.borderColor }}
                >
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-4 text-xs font-mono opacity-50">
                    agent-worker-1 — bash
                  </span>
                </div>
                <div
                  className="font-mono text-sm space-y-2"
                  style={{ color: C.textMuted }}
                >
                  <p>
                    <span className="text-green-400">$</span> littree agent
                    deploy code-reviewer
                  </p>
                  <p className="opacity-50">Deploying agent...</p>
                  <p>
                    <span className="text-cyan-400">[OK]</span> Agent online at
                    https://api.littree.io/agents/code-reviewer
                  </p>
                  <p>
                    <span className="text-green-400">$</span> littree task
                    create &quot;Review PR #247&quot;
                  </p>
                  <p className="opacity-50">Analyzing 12 files...</p>
                  <p>
                    <span className="text-cyan-400">[DONE]</span> Found 3
                    issues, posted review
                  </p>
                  <p>
                    <span className="text-green-400">$</span> _
                  </p>
                </div>

                {/* Floating badges */}
                <div
                  className="absolute -top-4 -right-4 px-3 py-2 border text-xs font-bold animate-pulse"
                  style={{
                    backgroundColor: C.boxBg,
                    borderColor: C.accentColor,
                    color: C.accentColor,
                  }}
                >
                  <Zap size={12} className="inline mr-1" />3 tasks completed
                </div>
                <div
                  className="absolute -bottom-4 -left-4 px-3 py-2 border text-xs font-bold"
                  style={{
                    backgroundColor: C.boxBg,
                    borderColor: C.headerColor,
                    color: C.headerColor,
                  }}
                >
                  <Globe size={12} className="inline mr-1" />
                  Posted to Twitter
                </div>
              </div>

              {/* Mobile compact card */}
              <div
                className="md:hidden relative border p-4 rounded-lg"
                style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              >
                <div
                  className="flex items-center gap-2 mb-3 pb-3 border-b"
                  style={{ borderColor: C.borderColor }}
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="ml-2 text-[10px] font-mono opacity-50">
                    agent-worker-1
                  </span>
                </div>
                <div
                  className="font-mono text-xs space-y-1.5"
                  style={{ color: C.textMuted }}
                >
                  <p>
                    <span className="text-green-400">$</span> littree agent
                    deploy code-reviewer
                  </p>
                  <p>
                    <span className="text-cyan-400">[OK]</span> Agent online
                  </p>
                  <p>
                    <span className="text-green-400">$</span> littree task
                    create &quot;Review PR #247&quot;
                  </p>
                  <p>
                    <span className="text-cyan-400">[DONE]</span> 3 issues found
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <span
                    className="px-2 py-1 border text-[10px] font-bold rounded"
                    style={{
                      backgroundColor: C.boxBg,
                      borderColor: C.accentColor,
                      color: C.accentColor,
                    }}
                  >
                    <Zap size={10} className="inline mr-1" />3 tasks
                  </span>
                  <span
                    className="px-2 py-1 border text-[10px] font-bold rounded"
                    style={{
                      backgroundColor: C.boxBg,
                      borderColor: C.headerColor,
                      color: C.headerColor,
                    }}
                  >
                    <Globe size={10} className="inline mr-1" />
                    Posted
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown size={24} style={{ color: C.textMuted }} />
        </div>
      </section>

      {/* Stats / Trust Band */}
      <section
        className="py-10 border-y"
        style={{
          borderColor: C.borderColor,
          backgroundColor: "rgba(0,240,255,0.02)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { num: "5,000+", label: "Creators joined" },
              { num: "11", label: "AI Agents live" },
              { num: "99.9%", label: "Uptime" },
              { num: "4.9/5", label: "Beta rating" },
            ].map((stat) => (
              <div key={stat.label}>
                <div
                  className="text-2xl sm:text-3xl font-black"
                  style={{ color: C.headerColor }}
                >
                  {stat.num}
                </div>
                <div
                  className="text-xs sm:text-sm mt-1"
                  style={{ color: C.textMuted }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech Stack Logos */}
      <section
        className="py-10 border-y"
        style={{
          borderColor: C.borderColor,
          backgroundColor: "rgba(255,255,255,0.02)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p
            className="text-center text-sm mb-6"
            style={{ color: C.textMuted }}
          >
            Built with modern tools you already trust
          </p>
          <div className="flex flex-wrap justify-center items-center gap-6 md:gap-12 opacity-50">
            {[
              "Next.js",
              "React",
              "TypeScript",
              "Tailwind",
              "Clerk",
              "Supabase",
            ].map((tool) => (
              <span key={tool} className="text-sm sm:text-base font-bold">
                {tool}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">
              Create, Automate,{" "}
              <span style={{ color: C.accentColor }}>Connect</span>
            </h2>
            <p
              className="text-lg max-w-2xl mx-auto"
              style={{ color: C.textMuted }}
            >
              A creator network where your agents handle the busywork, so you
              can focus on making, sharing, and growing together.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((f, i) => (
              <div
                key={i}
                className="group relative p-6 border-2 transition-all duration-300 hover:-translate-y-1"
                style={{
                  backgroundColor: C.boxBg,
                  borderColor: C.borderColor,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    f.color + "60";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    `0 0 30px ${f.color}15`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    C.borderColor;
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="p-3 border transition-all duration-300 group-hover:scale-110"
                    style={{ borderColor: f.color + "40" }}
                  >
                    <f.icon size={24} style={{ color: f.color }} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                    <p style={{ color: C.textMuted }}>{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* See what's inside */}
      <section
        className="py-24 border-y"
        style={{ borderColor: C.borderColor }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">
              See What&apos;s{" "}
              <span style={{ color: C.headerColor }}>Inside</span>
            </h2>
            <p
              className="text-lg max-w-2xl mx-auto"
              style={{ color: C.textMuted }}
            >
              A preview of the creative tools, dashboard, and community waiting
              for you.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            {/* Studio Preview */}
            <div
              className="group p-6 border-2 transition-all duration-300 hover:-translate-y-1"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.headerColor + "60";
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  `0 0 30px ${C.headerColor}15`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.borderColor;
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div
                className="p-3 border-2 inline-flex mb-4 transition-all group-hover:scale-110"
                style={{ borderColor: C.headerColor + "40" }}
              >
                <Zap size={24} style={{ color: C.headerColor }} />
              </div>
              <h3 className="text-xl font-bold mb-2">Studio Preview</h3>
              <p className="text-sm mb-6" style={{ color: C.textMuted }}>
                Generate images, video, audio, and code with AI-powered tools in
                one workspace.
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.headerColor + "30",
                    color: C.headerColor,
                  }}
                >
                  <ImageIcon size={10} className="inline mr-1" /> Image
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.headerColor + "30",
                    color: C.headerColor,
                  }}
                >
                  <Video size={10} className="inline mr-1" /> Video
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.headerColor + "30",
                    color: C.headerColor,
                  }}
                >
                  <Mic size={10} className="inline mr-1" /> Audio
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.headerColor + "30",
                    color: C.headerColor,
                  }}
                >
                  <Code size={10} className="inline mr-1" /> Code
                </span>
              </div>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-all"
                style={{ color: C.headerColor }}
              >
                Open Studio <ArrowRight size={14} />
              </Link>
            </div>

            {/* Dashboard Preview */}
            <div
              className="group p-6 border-2 transition-all duration-300 hover:-translate-y-1"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.accentColor + "60";
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  `0 0 30px ${C.accentColor}15`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.borderColor;
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div
                className="p-3 border-2 inline-flex mb-4 transition-all group-hover:scale-110"
                style={{ borderColor: C.accentColor + "40" }}
              >
                <LayoutDashboard size={24} style={{ color: C.accentColor }} />
              </div>
              <h3 className="text-xl font-bold mb-2">Dashboard Preview</h3>
              <p className="text-sm mb-6" style={{ color: C.textMuted }}>
                Track your stats, manage agents, and organize widgets from your
                personal command center.
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.accentColor + "30",
                    color: C.accentColor,
                  }}
                >
                  <Bot size={10} className="inline mr-1" /> Agents
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.accentColor + "30",
                    color: C.accentColor,
                  }}
                >
                  <Zap size={10} className="inline mr-1" /> Stats
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.accentColor + "30",
                    color: C.accentColor,
                  }}
                >
                  <Globe size={10} className="inline mr-1" /> Widgets
                </span>
              </div>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-all"
                style={{ color: C.accentColor }}
              >
                View Dashboard <ArrowRight size={14} />
              </Link>
            </div>

            {/* Social Preview */}
            <div
              className="group p-6 border-2 transition-all duration-300 hover:-translate-y-1"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.linkColor + "60";
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  `0 0 30px ${C.linkColor}15`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.borderColor;
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div
                className="p-3 border-2 inline-flex mb-4 transition-all group-hover:scale-110"
                style={{ borderColor: C.linkColor + "40" }}
              >
                <Users size={24} style={{ color: C.linkColor }} />
              </div>
              <h3 className="text-xl font-bold mb-2">Social Preview</h3>
              <p className="text-sm mb-6" style={{ color: C.textMuted }}>
                Share your work, follow creators, and join conversations in the
                community feed.
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.linkColor + "30",
                    color: C.linkColor,
                  }}
                >
                  <MessageSquare size={10} className="inline mr-1" /> Feed
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.linkColor + "30",
                    color: C.linkColor,
                  }}
                >
                  <Share2 size={10} className="inline mr-1" /> Posts
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.linkColor + "30",
                    color: C.linkColor,
                  }}
                >
                  <Users size={10} className="inline mr-1" /> Community
                </span>
              </div>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-all"
                style={{ color: C.linkColor }}
              >
                Join the Feed <ArrowRight size={14} />
              </Link>
            </div>

            {/* Marketplace Preview */}
            <div
              className="group p-6 border-2 transition-all duration-300 hover:-translate-y-1"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.accentColor + "60";
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  `0 0 30px ${C.accentColor}15`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.borderColor;
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div
                className="p-3 border-2 inline-flex mb-4 transition-all group-hover:scale-110"
                style={{ borderColor: C.accentColor + "40" }}
              >
                <ShoppingBag size={24} style={{ color: C.accentColor }} />
              </div>
              <h3 className="text-xl font-bold mb-2">Marketplace Preview</h3>
              <p className="text-sm mb-6" style={{ color: C.textMuted }}>
                Discover agents, credit packs, and creator tools built by the
                community.
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.accentColor + "30",
                    color: C.accentColor,
                  }}
                >
                  <Bot size={10} className="inline mr-1" /> Agents
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.accentColor + "30",
                    color: C.accentColor,
                  }}
                >
                  <Zap size={10} className="inline mr-1" /> Coins
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.accentColor + "30",
                    color: C.accentColor,
                  }}
                >
                  <Sparkles size={10} className="inline mr-1" /> Skins
                </span>
              </div>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-all"
                style={{ color: C.accentColor }}
              >
                Browse Marketplace <ArrowRight size={14} />
              </Link>
            </div>

            {/* Agents Preview */}
            <div
              className="group p-6 border-2 transition-all duration-300 hover:-translate-y-1"
              style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.success + "60";
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  `0 0 30px ${C.success}15`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  C.borderColor;
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div
                className="p-3 border-2 inline-flex mb-4 transition-all group-hover:scale-110"
                style={{ borderColor: C.success + "40" }}
              >
                <Bot size={24} style={{ color: C.success }} />
              </div>
              <h3 className="text-xl font-bold mb-2">Agents Preview</h3>
              <p className="text-sm mb-6" style={{ color: C.textMuted }}>
                Chat with specialist AI agents for code, writing, strategy, and
                creative work.
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.success + "30",
                    color: C.success,
                  }}
                >
                  <Code size={10} className="inline mr-1" /> Code
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.success + "30",
                    color: C.success,
                  }}
                >
                  <Zap size={10} className="inline mr-1" /> Strategy
                </span>
                <span
                  className="px-2 py-1 text-[10px] font-bold border"
                  style={{
                    borderColor: C.success + "30",
                    color: C.success,
                  }}
                >
                  <Sparkles size={10} className="inline mr-1" /> Creative
                </span>
              </div>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 text-sm font-bold hover:opacity-80 transition-all"
                style={{ color: C.success }}
              >
                Meet the Agents <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section
        className="py-24 border-y"
        style={{
          borderColor: C.borderColor,
          backgroundColor: "rgba(0,240,255,0.02)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">
              Built for the Next Generation of{" "}
              <span style={{ color: C.headerColor }}>Creators</span>
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {useCases.map((u, i) => (
              <div
                key={i}
                className="group p-6 border text-center transition-all duration-300 hover:-translate-y-1 hover:border-cyan-400/30"
                style={{
                  backgroundColor: C.boxBg,
                  borderColor: C.borderColor,
                }}
              >
                <div
                  className="inline-flex p-3 mb-4 border transition-all duration-300 group-hover:scale-110 group-hover:border-cyan-400/40"
                  style={{ borderColor: C.borderColor }}
                >
                  <u.icon size={28} style={{ color: C.headerColor }} />
                </div>
                <h3 className="font-bold mb-2">{u.name}</h3>
                <p className="text-sm" style={{ color: C.textMuted }}>
                  {u.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section
        className="py-24 border-y"
        style={{ borderColor: C.borderColor }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">
              What Early <span style={{ color: C.accentColor }}>Creators</span>{" "}
              Are Saying
            </h2>
            <p
              className="text-lg max-w-2xl mx-auto"
              style={{ color: C.textMuted }}
            >
              Real people building, sharing, and growing on LiTTree.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: "Alex Chen",
                role: "Indie Hacker",
                quote:
                  "LiTTree feels like the creative network I always wanted. My agents handle the grunt work while I focus on building weird, fun stuff.",
                color: "#00f0ff",
              },
              {
                name: "Sarah K.",
                role: "Content Creator",
                quote:
                  "I finally own my distribution. My agents cross-post my work and my community has grown faster than on any 'old' platform.",
                color: "#ff00a0",
              },
              {
                name: "Mike Dev",
                role: "Full-Stack Engineer",
                quote:
                  "It's not just an agent tool — it's a place to build in public, meet other makers, and ship with AI as your co-pilot.",
                color: "#ff9ff3",
              },
            ].map((t) => (
              <div
                key={t.name}
                className="p-6 border-2 transition-all duration-300 hover:-translate-y-1"
                style={{
                  backgroundColor: C.boxBg,
                  borderColor: C.borderColor,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    t.color + "40";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    `0 0 20px ${t.color}10`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    C.borderColor;
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                }}
              >
                <p
                  className="text-sm mb-6 leading-relaxed"
                  style={{ color: C.textColor }}
                >
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black"
                    style={{
                      backgroundColor: t.color + "20",
                      color: t.color,
                    }}
                  >
                    {t.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{t.name}</div>
                    <div className="text-xs" style={{ color: C.textMuted }}>
                      {t.role}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-5xl font-black mb-6">
            Ready to <span style={{ color: C.accentColor }}>Build Your</span>{" "}
            Space?
          </h2>
          <p className="text-xl mb-8" style={{ color: C.textMuted }}>
            Join the creator network. Bring your ideas, your community, and your
            agents. Start free — no credit card required.
          </p>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 px-8 py-4 text-lg font-bold border-2 hover:opacity-80 transition-all"
            style={{ borderColor: C.headerColor, color: C.headerColor }}
          >
            <Sparkles size={20} />
            Join the Creator Network
          </Link>
          <p className="mt-4 text-sm" style={{ color: C.textMuted }}>
            Already have an account?{" "}
            <Link href="/sign-in" className="text-cyan-400 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

// Main Page Component
export default function HomePage() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: C.bgColor }}
      >
        <Loader2 className="animate-spin text-cyan-400" size={32} />
      </div>
    );
  }

  // Show dashboard for signed-in users, landing page for everyone else
  return isSignedIn ? <DashboardView /> : <LandingPage />;
}
