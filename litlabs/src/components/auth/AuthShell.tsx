"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";

const AUTH_BG = "#08080c";
const PANEL_BG = "#101018";
const PANEL_BORDER = "#1e1e2e";
const CYAN = "#22d3ee";
const INDIGO = "#6366f1";
const TEXT = "#f0f0f6";
const MUTED = "#64748b";

interface AuthShellProps {
  children: ReactNode;
  mode: "sign-in" | "sign-up";
  headline: string;
  subcopy: string;
}

export function AuthShell({ children, mode, headline, subcopy }: AuthShellProps) {
  void mode;
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8 relative overflow-hidden"
      style={{ backgroundColor: AUTH_BG, color: TEXT }}
    >
      {/* Background ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: `radial-gradient(circle, ${INDIGO} 0%, transparent 70%)`, filter: "blur(80px)" }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: `radial-gradient(circle, ${CYAN} 0%, transparent 70%)`, filter: "blur(80px)" }} />
      </div>

      <div className="relative w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">

        {/* ── LEFT: Brand panel ── */}
        <div
          className="flex flex-col justify-between rounded-2xl p-7 border order-2 lg:order-1"
          style={{ backgroundColor: PANEL_BG, borderColor: PANEL_BORDER }}
        >
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 mb-8 group">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs transition-all group-hover:scale-110"
                style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff" }}>L</div>
              <span className="font-black text-sm tracking-wide" style={{ color: TEXT }}>LiTTree OS</span>
            </Link>

            <h1 className="text-2xl sm:text-3xl font-black leading-tight mb-2">Your AI operating system for creators.</h1>
            <p className="text-sm leading-relaxed mb-8" style={{ color: MUTED }}>
              Build apps, generate content, run agents, play games, sell assets, and automate work — all from one workspace.
            </p>

            <ul className="space-y-3 mb-8">
              {[
                "Continue projects",
                "Access agents",
                "Open Studio",
                "Manage marketplace",
                "Keep your memory",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
                  <Check size={14} style={{ color: CYAN }} /> {item}
                </li>
              ))}
            </ul>

            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ borderColor: `${CYAN}30`, color: CYAN, backgroundColor: `${CYAN}08` }}
            >
              Starter included: 500 credits · LiT Chat · Arcade · 3 agents
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-[10px]" style={{ color: MUTED }}>No credit card required. 500 credits included.</span>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px]" style={{ color: MUTED }}>All systems online</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Clerk form ── */}
        <div
          className="flex flex-col rounded-2xl p-7 border order-1 lg:order-2"
          style={{ backgroundColor: PANEL_BG, borderColor: PANEL_BORDER }}
        >
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-full max-w-sm">
              <div className="mb-6 text-center lg:text-left">
                <h2 className="text-xl font-black" style={{ color: TEXT }}>{headline}</h2>
                <p className="text-sm mt-1" style={{ color: MUTED }}>{subcopy}</p>
              </div>
              {children}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t text-center" style={{ borderColor: PANEL_BORDER }}>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-bold" style={{ color: MUTED }}>
              <Link href="/" className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-80">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to LiTTree OS
              </Link>
              <span className="hidden sm:inline">·</span>
              <Link href="/privacy" className="hover:text-cyan-400 transition-colors">Privacy</Link>
              <span>·</span>
              <Link href="/terms" className="hover:text-cyan-400 transition-colors">Terms</Link>
            </div>
            <div className="mt-2 text-[10px]" style={{ color: MUTED }}>
              © 2026 LiTTree Labs. All Systems Operational.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const clerkAuthAppearance = {
  elements: {
    formButtonPrimary: {
      backgroundColor: INDIGO,
      color: "#fff",
      border: "none",
      fontSize: "13px",
      fontWeight: "bold",
      borderRadius: "8px",
    },
    formFieldInput: {
      backgroundColor: "#0a0a0f",
      border: `1px solid ${PANEL_BORDER}`,
      color: TEXT,
      borderRadius: "8px",
    },
    footerActionLink: { color: CYAN },
    headerTitle: { color: TEXT },
    headerSubtitle: { color: MUTED },
    socialButtonsBlockButton: {
      border: `1px solid ${PANEL_BORDER}`,
      backgroundColor: "transparent",
      borderRadius: "8px",
    },
    card: { backgroundColor: "transparent", boxShadow: "none" },
    formFieldLabel: { color: MUTED, fontSize: "12px" },
    identityPreviewText: { color: TEXT },
    alternativeMethodsBlockButton: {
      border: `1px solid ${PANEL_BORDER}`,
      color: MUTED,
      borderRadius: "8px",
    },
  },
  variables: {
    colorPrimary: INDIGO,
    colorBackground: PANEL_BG,
    colorText: TEXT,
    colorTextSecondary: MUTED,
    colorInputBackground: "#0a0a0f",
    colorInputText: TEXT,
    borderRadius: "8px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
};
