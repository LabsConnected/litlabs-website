"use client";

import Link from "next/link";
import {
  Code2,
  Eye,
  FolderGit2,
  Play,
  ArrowRight,
  Terminal,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";

export default function BuilderTool() {
  const { resolvedColors: T } = useTheme();

  const primaryActions = [
    {
      icon: FolderGit2,
      label: "Workspace",
      desc: "Edit project files",
      href: "/code",
    },
    {
      icon: Terminal,
      label: "Terminal",
      desc: "Run shell commands",
      href: "/studio?tool=terminal",
    },
    {
      icon: Play,
      label: "Build",
      desc: "Run verified builds",
      href: "/studio?tool=terminal",
    },
    {
      icon: Eye,
      label: "Preview",
      desc: "Open live result",
      href: "/projects",
    },
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
      <SystemTopologyPanel compact />

      {/* Primary prompt card */}
      <section
        className="rounded-2xl border p-4"
        style={{ borderColor: T.borderColor + "25", backgroundColor: T.boxBg }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Code2
            size={16}
            aria-hidden="true"
            style={{ color: T.accentColor }}
          />
          <div>
            <p className="text-xs font-black uppercase tracking-wider">
              AI Builder
            </p>
            <p className="text-[10px]" style={{ color: T.textMuted }}>
              Prompt → files → build → preview
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {primaryActions.map((a) => {
            const I = a.icon;
            return (
              <Link
                key={a.label}
                href={a.href}
                className="group flex flex-col items-start gap-1.5 rounded-xl border p-3 transition hover:border-cyan-500/30 hover:bg-cyan-500/5"
                style={{
                  borderColor: T.borderColor + "20",
                  backgroundColor: T.bgColor + "60",
                }}
                aria-label={`${a.label}: ${a.desc}`}
              >
                <I
                  size={15}
                  aria-hidden="true"
                  style={{ color: T.accentColor }}
                />
                <p className="text-xs font-bold">{a.label}</p>
                <p className="text-[9px]" style={{ color: T.textMuted }}>
                  {a.desc}
                </p>
              </Link>
            );
          })}
        </div>

        <Link
          href="/code"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-bold transition hover:bg-white/5"
          style={{ borderColor: T.borderColor + "20", color: T.textColor }}
        >
          Open full code workspace <ArrowRight size={10} aria-hidden="true" />
        </Link>
      </section>

      {/* Project context card */}
      <aside
        className="rounded-2xl border p-4"
        style={{ borderColor: T.borderColor + "25", backgroundColor: T.boxBg }}
      >
        <p
          className="text-[9px] font-black uppercase tracking-[0.2em]"
          style={{ color: T.accentColor }}
        >
          Project
        </p>
        <h3 className="mt-1 text-sm font-black">LiTTree-LabStudios</h3>
        <p
          className="mt-2 text-[10px] leading-relaxed"
          style={{ color: T.textMuted }}
        >
          Repository, terminal, agents, media tools, and deployment live in one
          operating surface.
        </p>
      </aside>
    </div>
  );
}
