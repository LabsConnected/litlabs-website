"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { ArrowLeft, Check, Zap, Star, Crown } from "lucide-react";

const AUTH_BG = "#08080c";
const PANEL_BG = "#101018";
const PANEL_BORDER = "#1e1e2e";
const CYAN = "#22d3ee";
const GREEN = "#a3f546";
const INDIGO = "#6366f1";
const TEXT = "#f0f0f6";
const MUTED = "#64748b";

interface AuthShellProps {
  children: ReactNode;
  mode: "sign-in" | "sign-up";
  headline: string;
  subcopy: string;
}

const TIER_PREVIEW = [
  { icon: Zap,   name: "Starter", price: "Free",  color: MUTED,  items: ["500 credits","3 agents","All games","LiT Chat"] },
  { icon: Star,  name: "Creator", price: "$12/mo", color: CYAN,   items: ["5K credits","10 agents","Flow Studio","Terminal"] },
  { icon: Crown, name: "Elite",   price: "$39/mo", color: GREEN,  items: ["Unlimited","Custom agents","Sell agents","API access"] },
];

export function AuthShell({ children, mode, headline, subcopy }: AuthShellProps) {
  const isSignUp = mode === "sign-up";

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
            {/* Logo */}
            <Link href="/" className="inline-flex items-center gap-2.5 mb-8 group">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs transition-all group-hover:scale-110"
                style={{ background: `linear-gradient(135deg, ${INDIGO}, ${CYAN})`, color: "#fff" }}>L</div>
              <span className="font-black text-sm tracking-wide" style={{ color: TEXT }}>LiTTree OS</span>
            </Link>

            {/* LiTT mascot + headline */}
            <div className="flex items-start gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                style={{ background: `linear-gradient(135deg, ${INDIGO}20, ${CYAN}15)`, border: `1px solid ${INDIGO}30` }}>
                🤖
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight mb-1">{headline}</h1>
                <p className="text-sm leading-relaxed" style={{ color: MUTED }}>{subcopy}</p>
              </div>
            </div>

            {/* Sign-up: credits banner */}
            {isSignUp && (
              <div className="rounded-xl border p-4 mb-6 flex items-center gap-3"
                style={{ backgroundColor: `${CYAN}08`, borderColor: `${CYAN}30` }}>
                <div className="text-2xl">🎁</div>
                <div>
                  <div className="font-black text-sm" style={{ color: CYAN }}>500 free starter credits</div>
                  <div className="text-xs" style={{ color: MUTED }}>No credit card. Boot into LiT OS in seconds.</div>
                </div>
              </div>
            )}

            {/* Tier preview */}
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: MUTED }}>
                {isSignUp ? "Choose your plan after sign-up" : "Your active plan"}
              </div>
              {TIER_PREVIEW.map((tier) => {
                const Icon = tier.icon;
                return (
                  <div key={tier.name}
                    className="flex items-start gap-3 rounded-xl p-3 border"
                    style={{ backgroundColor: `${tier.color}06`, borderColor: `${tier.color}20` }}>
                    <Icon size={14} className="shrink-0 mt-0.5" style={{ color: tier.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-black" style={{ color: TEXT }}>{tier.name}</span>
                        <span className="text-[10px] font-bold" style={{ color: tier.color }}>{tier.price}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {tier.items.map((f) => (
                          <span key={f} className="inline-flex items-center gap-1 text-[9px]" style={{ color: MUTED }}>
                            <Check size={8} style={{ color: tier.color }} />{f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-[10px]" style={{ color: MUTED }}>No credit card required to start.</span>
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
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-sm">{children}</div>
          </div>

          <div className="mt-6 pt-5 border-t text-center" style={{ borderColor: PANEL_BORDER }}>
            <Link href="/"
              className="inline-flex items-center gap-1.5 text-xs font-bold transition-opacity hover:opacity-80"
              style={{ color: MUTED }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back to LiTTree OS
            </Link>
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
