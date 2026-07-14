"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";
import PageShell from "@/components/PageShell";

export default function ShowcasePage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !userId) {
      router.push("/sign-in?redirect_url=/showcase");
    }
  }, [isLoaded, userId, router]);

  if (!isLoaded) {
    return (
      <PageShell>
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-500">
          Loading showcase...
        </div>
      </PageShell>
    );
  }

  return <ShowcasePageInner />;
}

function ShowcasePageInner() {
  const { resolvedColors: T } = useTheme();
  const [activeTab, setActiveTab] = useState<
    "images" | "architecture" | "case-study"
  >("images");
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const showcaseImages = [
    {
      src: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1024&auto=format&fit=crop",
      title: "The Cover",
      label: "Automated Multi-Agent Architecture",
      desc: "A bold, cinematic visualization of the dual-agent system. Two AI agents connected by a luminous neural pathway — the centerpiece hook for high-value clients.",
    },
    {
      src: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=1024&auto=format&fit=crop",
      title: "The Engine",
      label: "Agent Routing in Action",
      desc: "Clean terminal view showing the Director agent routing a task to the Executor. Real-time logs prove the system actually works — no smoke and mirrors.",
    },
    {
      src: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1024&auto=format&fit=crop",
      title: "The Control Center",
      label: "Live Telemetry Dashboard",
      desc: "The monitoring layer. Agent status, live log streams, system metrics — all in a premium dark volcanic UI that communicates enterprise-grade infrastructure.",
    },
    {
      src: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?q=80&w=1024&auto=format&fit=crop",
      title: "Before & After",
      label: "The Transformation",
      desc: "A side-by-side comparison of a manual workflow vs your automated system. Visual proof of time saved and chaos eliminated — the fastest way to communicate value.",
    },
  ];

  return (
    <PageShell
      title="Showcase"
      subtitle="Featured projects and architecture"
      className="relative"
    >
      <div
        className="w-full bg-black py-1.5 border-b-2 overflow-hidden flex"
        style={{ borderColor: T.borderColor, color: T.accentColor }}
      >
        <div className="whitespace-nowrap animate-marquee flex gap-12 font-bold uppercase tracking-wider text-[10px]">
          <span>AUTOMATION SHOWCASE // PORTFOLIO &amp; PROOF</span>
          <span>SYSTEM ARCHITECTURE MAPS // CASE STUDIES</span>
          <span>ENTERPRISE-GRADE INFRASTRUCTURE VISUALS</span>
        </div>
      </div>

      {/* Hero Header */}
      <div
        style={{
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
          background: `linear-gradient(180deg, rgba(0,229,255,0.06) 0%, transparent 100%)`,
          padding: "64px 24px 48px",
          textAlign: "center",
        }}
      >
        <p
          className="section-eyebrow"
          style={{
            justifyContent: "center",
            marginBottom: "16px",
            fontFamily: "var(--font-display)",
          }}
        >
          Portfolio & Proof
        </p>
        <h1
          className="font-display text-4xl md:text-5xl font-black mb-4"
          style={{ fontFamily: "var(--font-display)" }}
        >
          <span className="gradient-text">Automation Showcase</span>
        </h1>
        <p
          style={{
            color: T.textColor,
            fontSize: "16px",
            maxWidth: "560px",
            margin: "0 auto 32px",
            lineHeight: "1.6",
            opacity: 0.75,
          }}
        >
          The assets that close deals. Project visuals, system architecture
          maps, and case studies built to communicate complex automation
          instantly.
        </p>
        <div className="flex justify-center gap-3 flex-wrap">
          {[
            { label: "View Images", tab: "images" as const },
            { label: "Architecture Map", tab: "architecture" as const },
            { label: "Case Study", tab: "case-study" as const },
          ].map((btn) => (
            <button
              key={btn.tab}
              onClick={() => setActiveTab(btn.tab)}
              className="btn text-xs"
              style={{
                background: activeTab === btn.tab ? T.linkColor : "transparent",
                color: activeTab === btn.tab ? "#0a0a0f" : T.textColor,
                borderColor:
                  activeTab === btn.tab ? T.linkColor : "rgba(255,255,255,0.1)",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: PROJECT IMAGES ── */}
      {activeTab === "images" && (
        <div className="w-full px-4 py-8 sm:px-6 sm:py-12">
          <div className="grid md:grid-cols-2 gap-8">
            {showcaseImages.map((img, i) => (
              <div
                key={i}
                className="card"
                style={{ padding: 0, overflow: "hidden" }}
              >
                <div
                  onClick={() => setLightboxImg(img.src)}
                  className="relative cursor-pointer overflow-hidden"
                  style={{ height: "280px" }}
                >
                  <Image
                    src={img.src}
                    alt={img.label}
                    fill
                    style={{ objectFit: "cover" }}
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.7) 100%)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "16px",
                      left: "16px",
                      right: "16px",
                    }}
                  >
                    <span className="badge text-[10px]">{img.title}</span>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      top: "12px",
                      right: "12px",
                      background: "rgba(0,0,0,0.6)",
                      borderRadius: "6px",
                      padding: "6px 10px",
                      fontSize: "11px",
                      color: "#fff",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    Expand
                  </div>
                </div>
                <div style={{ padding: "20px" }}>
                  <h3
                    className="font-display text-sm font-bold uppercase tracking-wider mb-2"
                    style={{ color: T.headerColor }}
                  >
                    {img.label}
                  </h3>
                  <p
                    style={{
                      fontSize: "13px",
                      lineHeight: "1.6",
                      color: T.textColor,
                      opacity: 0.75,
                    }}
                  >
                    {img.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Strategy Note */}
          <div
            className="mt-12 p-6 rounded-lg"
            style={{
              background: "rgba(0,229,255,0.04)",
              border: `1px solid rgba(0,229,255,0.12)`,
            }}
          >
            <h4
              className="font-display text-xs uppercase tracking-widest mb-3"
              style={{ color: T.headerColor }}
            >
              Why These Images Work
            </h4>
            <div
              className="grid md:grid-cols-3 gap-4 text-xs"
              style={{ color: T.textColor, opacity: 0.75 }}
            >
              <div>
                <strong
                  style={{
                    color: T.accentColor,
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  The Hook
                </strong>
                Cover + Engine images grab attention in under 2 seconds. No
                dense screenshots — just bold visual statements.
              </div>
              <div>
                <strong
                  style={{
                    color: T.accentColor,
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  The Proof
                </strong>
                Control Center + Before/After prove functionality. Clients need
                to see the system working, not just hear about it.
              </div>
              <div>
                <strong
                  style={{
                    color: T.accentColor,
                    display: "block",
                    marginBottom: "4px",
                  }}
                >
                  The Format
                </strong>
                Dark volcanic theme with glowing accents communicates premium.
                Technical data that looks expensive closes higher-value deals.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: ARCHITECTURE MAP ── */}
      {activeTab === "architecture" && (
        <div className="w-full px-4 py-8 sm:px-6 sm:py-12">
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span className="dot" />
                System Architecture Map — Dual-Agent Automation Pipeline
              </div>
              <button
                onClick={() => window.print()}
                className="btn btn-secondary text-xs"
                style={{ fontSize: "11px", padding: "6px 14px" }}
              >
                Print / Save PDF
              </button>
            </div>

            {/* Architecture Diagram - styled as a visual flow */}
            <div
              className="relative"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderRadius: "12px",
                padding: "32px",
                marginBottom: "24px",
                border: `1px solid rgba(255,255,255,0.04)`,
              }}
            >
              {/* Grid dots background */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "12px",
                  opacity: 0.15,
                  backgroundImage:
                    "radial-gradient(circle, rgba(0,229,255,0.5) 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />

              <div className="relative space-y-8">
                {/* INPUT */}
                <div className="flex justify-center">
                  <div className="text-center">
                    <div
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border-2"
                      style={{
                        borderColor: T.accentColor,
                        background: "rgba(247,255,0,0.08)",
                      }}
                    >
                      <span style={{ fontSize: "14px", fontWeight: "bold" }}>
                        IN
                      </span>
                      <div>
                        <div
                          className="font-display text-xs font-bold uppercase tracking-wider"
                          style={{ color: T.accentColor }}
                        >
                          Input Trigger
                        </div>
                        <div
                          className="font-mono text-[10px]"
                          style={{ color: T.textColor, opacity: 0.6 }}
                        >
                          Email / Webhook / API / Schedule
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-px h-6"
                      style={{
                        background: `linear-gradient(180deg, ${T.accentColor}, ${T.linkColor})`,
                      }}
                    />
                    <span
                      className="font-mono text-[9px]"
                      style={{ color: T.textMuted }}
                    >
                      task routed
                    </span>
                  </div>
                </div>

                {/* DIRECTOR NODE */}
                <div className="flex justify-center">
                  <div
                    className="inline-flex items-center gap-3 px-6 py-4 rounded-xl border-2"
                    style={{
                      borderColor: T.linkColor,
                      background: `linear-gradient(135deg, rgba(255,45,138,0.12), rgba(0,229,255,0.08))`,
                      boxShadow: `0 0 24px rgba(255,45,138,0.2)`,
                    }}
                  >
                    <span style={{ fontSize: "18px", fontWeight: "bold" }}>
                      DR
                    </span>
                    <div className="text-left">
                      <div
                        className="font-display text-base font-bold"
                        style={{ color: T.linkColor }}
                      >
                        Director Agent
                      </div>
                      <div
                        className="font-mono text-[10px] mt-0.5"
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        Decision Logic Layer
                        <br />
                        • Parses intent
                        <br />
                        • Classifies task type
                        <br />• Routes to Executor
                      </div>
                    </div>
                    <div
                      className="ml-2 px-2 py-1 rounded text-[9px] font-display uppercase tracking-wider"
                      style={{
                        background: "rgba(255,45,138,0.2)",
                        color: T.linkColor,
                        border: `1px solid ${T.linkColor}`,
                      }}
                    >
                      Orchestrator
                    </div>
                  </div>
                </div>

                {/* Routing Arrow */}
                <div className="flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-px h-6"
                      style={{
                        background: `linear-gradient(180deg, ${T.linkColor}, ${T.success})`,
                      }}
                    />
                    <span
                      className="font-mono text-[9px]"
                      style={{ color: T.textMuted }}
                    >
                      task dispatched
                    </span>
                  </div>
                </div>

                {/* EXECUTOR NODE */}
                <div className="flex justify-center">
                  <div
                    className="inline-flex items-center gap-3 px-6 py-4 rounded-xl border-2"
                    style={{
                      borderColor: T.success,
                      background: "rgba(37,224,138,0.08)",
                      boxShadow: `0 0 24px rgba(37,224,138,0.15)`,
                    }}
                  >
                    <span style={{ fontSize: "32px" }}>⚡</span>
                    <div className="text-left">
                      <div
                        className="font-display text-base font-bold"
                        style={{ color: T.success }}
                      >
                        Executor Agent
                      </div>
                      <div
                        className="font-mono text-[10px] mt-0.5"
                        style={{ color: T.textColor, opacity: 0.7 }}
                      >
                        Action Execution Layer
                        <br />
                        • Executes workflow
                        <br />
                        • Calls APIs / Scripts
                        <br />• Returns result
                      </div>
                    </div>
                    <div
                      className="ml-2 px-2 py-1 rounded text-[9px] font-display uppercase tracking-wider"
                      style={{
                        background: "rgba(37,224,138,0.2)",
                        color: T.success,
                        border: `1px solid ${T.success}`,
                      }}
                    >
                      Worker
                    </div>
                  </div>
                </div>

                {/* Output */}
                <div className="flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-px h-6"
                      style={{ background: T.success }}
                    />
                  </div>
                </div>

                <div className="flex justify-center">
                  <div
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border-2"
                    style={{
                      borderColor: T.success,
                      background: "rgba(37,224,138,0.08)",
                    }}
                  >
                    <span style={{ fontSize: "24px" }}>📤</span>
                    <div>
                      <div
                        className="font-display text-xs font-bold uppercase tracking-wider"
                        style={{ color: T.success }}
                      >
                        Output / Logging
                      </div>
                      <div
                        className="font-mono text-[10px]"
                        style={{ color: T.textColor, opacity: 0.6 }}
                      >
                        Result stored · Telemetry updated · User notified
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Component Legend */}
            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  icon: "📥",
                  name: "Input Triggers",
                  desc: "Email, webhook, API call, or scheduled event initiates the pipeline.",
                  color: T.accentColor,
                },
                {
                  icon: "🎯",
                  name: "Director Agent",
                  desc: "Classifies intent and dispatches tasks to the appropriate Executor.",
                  color: T.linkColor,
                },
                {
                  icon: "⚡",
                  name: "Executor Agent",
                  desc: "Runs the action — script execution, API calls, database writes, or report generation.",
                  color: T.success,
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg"
                  style={{
                    background: "rgba(0,0,0,0.25)",
                    border: `1px solid rgba(255,255,255,0.04)`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ fontSize: "20px" }}>{item.icon}</span>
                    <span
                      className="font-display text-xs font-bold"
                      style={{ color: item.color }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <p
                    className="text-xs"
                    style={{
                      color: T.textColor,
                      opacity: 0.65,
                      lineHeight: "1.5",
                    }}
                  >
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            <div
              className="mt-6 p-4 rounded-lg"
              style={{
                background: "rgba(255,45,138,0.04)",
                border: `1px solid rgba(255,45,138,0.12)`,
              }}
            >
              <p
                className="text-xs"
                style={{ color: T.textColor, opacity: 0.7 }}
              >
                <strong style={{ color: T.linkColor }}>Print this page</strong>{" "}
                to save as a high-resolution PDF. Share with prospective clients
                to demonstrate architectural depth before a discovery call. The
                visual structure communicates competence in under 30 seconds.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: CASE STUDY ── */}
      {activeTab === "case-study" && (
        <div className="w-full px-4 py-8 sm:px-6 sm:py-12">
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span className="dot" />
                Case Study — Commercial Research Automation
              </div>
              <button
                onClick={() => window.print()}
                className="btn btn-secondary text-xs"
                style={{ fontSize: "11px", padding: "6px 14px" }}
              >
                ⬇ Print / Save PDF
              </button>
            </div>

            {/* Header */}
            <div
              className="mb-8 pb-6 border-b"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h2
                    className="font-display text-xl font-black mb-1"
                    style={{ color: T.textColor }}
                  >
                    Dual-Agent Commercial Research Pipeline
                  </h2>
                  <p className="text-sm" style={{ color: T.textMuted }}>
                    Reducing 4-hour manual research tasks to 90-second automated
                    workflows
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="badge-success badge">Verified Results</span>
                  <span className="badge">n8n + Gemini</span>
                </div>
              </div>
            </div>

            {/* Problem / Solution */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div
                className="p-5 rounded-lg"
                style={{
                  background: "rgba(255,56,96,0.06)",
                  border: `1px solid rgba(255,56,96,0.2)`,
                }}
              >
                <h4
                  className="font-display text-xs uppercase tracking-widest mb-3"
                  style={{ color: "#ff3860" }}
                >
                  ❌ Before
                </h4>
                <ul
                  className="space-y-2 text-xs"
                  style={{
                    color: T.textColor,
                    opacity: 0.75,
                    lineHeight: "1.6",
                  }}
                >
                  <li>• Manual research across 5+ tools per campaign</li>
                  <li>• 4+ hours per market intelligence report</li>
                  <li>• Copy-paste errors and inconsistent formatting</li>
                  <li>• No scalable repeatable process</li>
                  <li>• Human bottleneck on high-volume days</li>
                </ul>
              </div>
              <div
                className="p-5 rounded-lg"
                style={{
                  background: "rgba(37,224,138,0.06)",
                  border: `1px solid rgba(37,224,138,0.2)`,
                }}
              >
                <h4
                  className="font-display text-xs uppercase tracking-widest mb-3"
                  style={{ color: T.success }}
                >
                  ✓ After
                </h4>
                <ul
                  className="space-y-2 text-xs"
                  style={{
                    color: T.textColor,
                    opacity: 0.75,
                    lineHeight: "1.6",
                  }}
                >
                  <li>• Fully automated end-to-end pipeline</li>
                  <li>• 90 seconds from trigger to deliverable</li>
                  <li>• Consistent, structured markdown output</li>
                  <li>• One-click repeatability, zero human error</li>
                  <li>• Scales to unlimited concurrent reports</li>
                </ul>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { val: "96%", label: "Time Reduction", sub: "4 hrs → 90 sec" },
                { val: "12x", label: "Throughput", sub: "Reports per day" },
                { val: "0", label: "Manual Steps", sub: "Fully automated" },
                {
                  val: "$2,400",
                  label: "Monthly Savings",
                  sub: "At $50/hr rate",
                },
              ].map((stat, i) => (
                <div key={i} className="metric">
                  <div className="metric-value" style={{ fontSize: "28px" }}>
                    {stat.val}
                  </div>
                  <div className="metric-label">{stat.label}</div>
                  <div
                    className="font-mono text-[9px] mt-1"
                    style={{ color: T.textMuted }}
                  >
                    {stat.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* Stack */}
            <div className="mb-8">
              <h4
                className="font-display text-xs uppercase tracking-widest mb-4"
                style={{ color: T.textMuted }}
              >
                Tools Orchestrated
              </h4>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  {
                    name: "n8n",
                    role: "Workflow Orchestration",
                    desc: "Visual node-based automation engine. Routes tasks between agents, handles webhooks, manages scheduling.",
                  },
                  {
                    name: "Gemini 2.0 Flash",
                    role: "LLM Processing",
                    desc: "Fast, cost-efficient model for intent classification, content generation, and structured output formatting.",
                  },
                  {
                    name: "Shell Scripting",
                    role: "Script Execution",
                    desc: "Custom bash/powershell scripts for file processing, API aggregation, and system-level operations.",
                  },
                  {
                    name: "Supabase",
                    role: "Data Persistence",
                    desc: "PostgreSQL-backed storage for telemetry logs, task history, and output caching.",
                  },
                ].map((tool, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-lg"
                    style={{
                      background: "rgba(0,0,0,0.25)",
                      border: `1px solid rgba(255,255,255,0.04)`,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="font-display text-sm font-bold"
                        style={{ color: T.headerColor }}
                      >
                        {tool.name}
                      </span>
                      <span
                        className="badge text-[9px]"
                        style={{ fontSize: "9px" }}
                      >
                        {tool.role}
                      </span>
                    </div>
                    <p
                      className="text-[11px]"
                      style={{
                        color: T.textColor,
                        opacity: 0.6,
                        lineHeight: "1.5",
                      }}
                    >
                      {tool.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div
              className="p-6 rounded-lg text-center"
              style={{
                background: `linear-gradient(135deg, rgba(255,45,138,0.08), rgba(0,229,255,0.08))`,
                border: `1px solid rgba(255,255,255,0.06)`,
              }}
            >
              <h4 className="font-display text-base font-black mb-2">
                Want This For Your Workflow?
              </h4>
              <p className="text-sm mb-4" style={{ color: T.textMuted }}>
                Book a discovery call and let&apos;s map your automation
                opportunity in 20 minutes.
              </p>
              <Link href="/agent-chat" className="btn btn-primary">
                🚀 Build My Pipeline
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── LIGHTBOX ── */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "1000px",
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "relative",
                height: "60vh",
                borderRadius: "12px",
                overflow: "hidden",
              }}
            >
              <Image
                src={lightboxImg}
                alt="Showcase"
                fill
                style={{ objectFit: "contain" }}
                sizes="1000px"
              />
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setLightboxImg(null)}
                className="btn btn-secondary text-xs"
              >
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back nav */}
      <div className="w-full px-4 pb-8 sm:px-6 sm:pb-12">
        <Link href="/" className="btn btn-ghost text-xs">
          ← Back to Studio
        </Link>
      </div>
    </PageShell>
  );
}
