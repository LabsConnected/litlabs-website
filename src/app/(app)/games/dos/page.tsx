"use client";

import dynamic from "next/dynamic";
import { useTheme } from "@/context/ThemeContext";
import PageShell from "@/components/PageShell";
import Link from "next/link";
import { ArrowLeft, Gamepad2 } from "lucide-react";

const DosPlayer = dynamic(() => import("@/components/games/DosPlayer"), {
  ssr: false,
  loading: () => (
    <div className="h-96 rounded-2xl animate-pulse bg-slate-800/30 border border-slate-700/30" />
  ),
});

export default function DosPage() {
  const { resolvedColors: T } = useTheme();

  return (
    <PageShell
      title="DOS Box Lab"
      subtitle="Run classic DOS games and apps in your browser"
      icon="🕹️"
    >
      <div className="px-4 sm:px-6 pt-4 space-y-4">
        {/* Back link */}
        <Link
          href="/games"
          className="inline-flex items-center gap-2 text-xs font-bold opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: T.textColor }}
        >
          <ArrowLeft size={14} /> Back to Game Cloud
        </Link>

        {/* Hero banner */}
        <div
          className="rounded-2xl border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(34,211,238,0.12), rgba(139,92,246,0.08))",
            borderColor: `${T.borderColor}30`,
          }}
        >
          <div>
            <div
              className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] mb-1"
              style={{ color: T.accentColor }}
            >
              <Gamepad2 size={12} /> Powered by js-dos 8.4
            </div>
            <p
              className="text-sm opacity-75 max-w-2xl"
              style={{ color: T.textColor }}
            >
              Full-featured DOS player with DOSBox-X backend, WebGL rendering,
              save/load support, and mobile controls. Upload your own{" "}
              <code className="font-mono">.jsdos</code> bundle and start
              playing.
            </p>
          </div>
        </div>

        {/* DOS Player */}
        <div className="max-w-4xl mx-auto">
          <DosPlayer />
        </div>

        {/* Feature list */}
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "DOSBox-X", desc: "Backend engine" },
            { label: "WebGL", desc: "3Dfx rendering" },
            { label: "Save/Load", desc: "Local persistence" },
            { label: "Mobile", desc: "Touch controls" },
          ].map((f) => (
            <div
              key={f.label}
              className="rounded-xl border p-3 text-center"
              style={{
                backgroundColor: `${T.boxBg}40`,
                borderColor: `${T.borderColor}30`,
              }}
            >
              <div
                className="text-sm font-black"
                style={{ color: T.accentColor }}
              >
                {f.label}
              </div>
              <div
                className="text-[10px] opacity-70"
                style={{ color: T.textMuted }}
              >
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
