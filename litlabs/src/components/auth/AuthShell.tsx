"use client";

import Link from "next/link";
import { ReactNode } from "react";
import {
  Bot,
  Coins,
  CreditCard,
  Rocket,
  Zap,
  ArrowLeft,
  Terminal,
} from "lucide-react";

const AUTH_BG = "#08080c";
const PANEL_BG = "#101018";
const PANEL_BORDER = "#252538";
const ACCENT_CYAN = "#00f5ff";
const ACCENT_INDIGO = "#6366f1";
const TEXT = "#f8fafc";
const TEXT_MUTED = "#94a3b8";

interface AuthShellProps {
  children: ReactNode;
  mode: "sign-in" | "sign-up";
  headline: string;
  subcopy: string;
}

const BENEFITS = [
  {
    icon: Bot,
    label: "Specialist agents",
    desc: "Code, content, media, research, and distribution.",
  },
  {
    icon: Terminal,
    label: "LiT Console",
    desc: "Chat, terminal, and agent orchestration in one workspace.",
  },
  {
    icon: Zap,
    label: "Workflow Studio",
    desc: "Chain prompts, tools, and publishing in one canvas.",
  },
  {
    icon: Rocket,
    label: "Deploy-ready",
    desc: "From idea to asset to published post without leaving the workspace.",
  },
];

export function AuthShell({
  children,
  mode,
  headline,
  subcopy,
}: AuthShellProps) {
  const isSignUp = mode === "sign-up";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ backgroundColor: AUTH_BG, color: TEXT }}
    >
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 items-stretch">
        {/* Left panel: brand promise */}
        <div
          className="flex flex-col justify-between rounded-2xl p-6 sm:p-8 lg:p-10 border order-2 lg:order-1"
          style={{ backgroundColor: PANEL_BG, borderColor: PANEL_BORDER }}
        >
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-bold mb-8 transition-opacity hover:opacity-80"
              style={{ color: TEXT_MUTED }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
                style={{
                  background: `linear-gradient(135deg, ${ACCENT_INDIGO}, ${ACCENT_CYAN})`,
                  color: "#fff",
                }}
              >
                L
              </div>
              LiTTree OS
            </Link>

            <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-4 leading-tight">
              {headline}
            </h1>
            <p
              className="text-base mb-8 leading-relaxed"
              style={{ color: TEXT_MUTED }}
            >
              {subcopy}
            </p>

            {isSignUp && (
              <div
                className="mb-8 rounded-xl border p-4 flex items-center gap-4"
                style={{
                  backgroundColor: "#00f5ff08",
                  borderColor: "#00f5ff30",
                }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#00f5ff15" }}
                >
                  <Coins className="h-6 w-6" style={{ color: ACCENT_CYAN }} />
                </div>
                <div>
                  <div
                    className="text-lg font-black"
                    style={{ color: ACCENT_CYAN }}
                  >
                    500 starter credits
                  </div>
                  <div className="text-xs" style={{ color: TEXT_MUTED }}>
                    No credit card required. First agent in minutes.
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {BENEFITS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex items-start gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: "#ffffff08" }}
                    >
                      <Icon
                        className="h-4 w-4"
                        style={{ color: ACCENT_CYAN }}
                      />
                    </div>
                    <div>
                      <div className="text-sm font-bold">{item.label}</div>
                      <div className="text-xs" style={{ color: TEXT_MUTED }}>
                        {item.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="mt-8 flex items-center gap-2 text-xs"
            style={{ color: TEXT_MUTED }}
          >
            <CreditCard className="h-3.5 w-3.5" />
            <span>
              Free to start. Upgrade only when you need more credits or agents.
            </span>
          </div>
        </div>

        {/* Right panel: Clerk form */}
        <div
          className="flex flex-col rounded-2xl p-6 sm:p-8 border order-1 lg:order-2"
          style={{ backgroundColor: PANEL_BG, borderColor: PANEL_BORDER }}
        >
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-sm">{children}</div>
          </div>

          <div
            className="mt-6 pt-6 border-t text-center"
            style={{ borderColor: PANEL_BORDER }}
          >
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-bold transition-opacity hover:opacity-80"
              style={{ color: TEXT_MUTED }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Home
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
      backgroundColor: ACCENT_INDIGO,
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
    footerActionLink: { color: ACCENT_CYAN },
    headerTitle: { color: TEXT },
    headerSubtitle: { color: TEXT_MUTED },
    socialButtonsBlockButton: {
      border: `1px solid ${PANEL_BORDER}`,
      backgroundColor: "transparent",
      borderRadius: "8px",
    },
    card: { backgroundColor: "transparent", boxShadow: "none" },
    formFieldLabel: { color: TEXT_MUTED, fontSize: "12px" },
    identityPreviewText: { color: TEXT },
    alternativeMethodsBlockButton: {
      border: `1px solid ${PANEL_BORDER}`,
      color: TEXT_MUTED,
      borderRadius: "8px",
    },
  },
  variables: {
    colorPrimary: ACCENT_INDIGO,
    colorBackground: PANEL_BG,
    colorText: TEXT,
    colorTextSecondary: TEXT_MUTED,
    colorInputBackground: "#0a0a0f",
    colorInputText: TEXT,
    borderRadius: "8px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
};
