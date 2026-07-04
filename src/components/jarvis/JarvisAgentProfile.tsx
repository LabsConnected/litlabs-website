"use client";

import Link from "next/link";
import { Terminal, Rocket, ScanLine, ArrowLeft, Brain, Settings, Zap } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { JarvisToolGrid } from "./JarvisToolGrid";
import { JarvisChatPanel } from "./JarvisChatPanel";

export function JarvisAgentProfile() {
  const { resolvedColors: T } = useTheme();

  return (
    <main className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="border-b px-4 py-3" style={{ borderColor: T.borderColor + "20" }}>
        <div className="mx-auto max-w-6xl">
          <Link
            href="/agents"
            className="inline-flex items-center gap-1.5 text-xs font-bold transition hover:opacity-70"
            style={{ color: T.textMuted }}
          >
            <ArrowLeft className="h-3 w-3" /> Back to Agents
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl border"
                style={{ backgroundColor: T.accentColor + "15", borderColor: T.accentColor + "30" }}
              >
                <Brain className="h-6 w-6" style={{ color: T.accentColor }} />
              </div>
              <div>
                <h1 className="text-2xl font-black md:text-3xl" style={{ color: T.headerColor }}>
                  Jarvis
                </h1>
                <p className="text-sm" style={{ color: T.textMuted }}>AI Dev OS Brain</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                style={{ backgroundColor: "rgba(52,211,153,0.12)", color: "#34d399" }}
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                Online
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ backgroundColor: T.boxBg, color: T.textMuted }}
              >
                System Agent
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/jarvis"
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <Terminal className="h-4 w-4" />
              Open Terminal
            </Link>
            <Link
              href="/jarvis"
              className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition"
              style={{ borderColor: T.borderColor + "30", color: T.textColor }}
            >
              <ScanLine className="h-4 w-4" />
              Run Scan
            </Link>
            <Link
              href="/settings?tab=agents"
              className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition"
              style={{ borderColor: T.borderColor + "30", color: T.textColor }}
            >
              <Settings className="h-4 w-4" />
              Configure
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            <div
              className="rounded-2xl border p-5"
              style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }}
            >
              <div className="mb-4">
                <h2 className="text-lg font-bold" style={{ color: T.headerColor }}>About Jarvis</h2>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: T.textMuted }}>
                  Jarvis is the AI operating layer for LiTTree OS. It connects directly to your terminal,
                  file system, logs, command history, and agent workflows. Unlike a separate chatbot,
                  Jarvis understands your full development context and can take actionable steps.
                </p>
              </div>

              <div className="relative my-5 aspect-video w-full overflow-hidden rounded-xl border" style={{ borderColor: T.borderColor + "20" }}>
                <img
                  src="/showcase/control-center.png"
                  alt="Jarvis control center"
                  className="h-full w-full object-cover"
                />
              </div>

              <JarvisToolGrid />
            </div>

            <div
              className="rounded-2xl border p-5"
              style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }}
            >
              <h3 className="mb-3 text-xs font-black uppercase tracking-wider" style={{ color: T.textMuted }}>
                Launch Actions
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border p-4 text-xs font-bold transition"
                  style={{ borderColor: T.borderColor + "25", color: T.textMuted }}
                >
                  <Terminal className="h-5 w-5" style={{ color: T.accentColor }} />
                  Terminal
                </Link>
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border p-4 text-xs font-bold transition"
                  style={{ borderColor: T.borderColor + "25", color: T.textMuted }}
                >
                  <ScanLine className="h-5 w-5" style={{ color: T.accentColor }} />
                  Scan
                </Link>
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border p-4 text-xs font-bold transition"
                  style={{ borderColor: T.borderColor + "25", color: T.textMuted }}
                >
                  <Zap className="h-5 w-5" style={{ color: T.accentColor }} />
                  Workflow
                </Link>
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border p-4 text-xs font-bold transition"
                  style={{ borderColor: T.borderColor + "25", color: T.textMuted }}
                >
                  <Rocket className="h-5 w-5" style={{ color: T.accentColor }} />
                  Deploy
                </Link>
              </div>
            </div>
          </div>

          <div className="lg:sticky lg:top-4 lg:h-fit">
            <JarvisChatPanel compact />
          </div>
        </div>
      </div>
    </main>
  );
}
