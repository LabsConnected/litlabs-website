"use client";

import Link from "next/link";
import { Code2, Eye, FolderGit2, Play } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";

export default function BuilderTool() {
  const { resolvedColors: T } = useTheme();
  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 overflow-auto">
      <SystemTopologyPanel />
      <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Code2 size={16} style={{ color: T.accentColor }} />
            <div>
              <p className="text-xs font-black uppercase tracking-wider">
                AI Builder
              </p>
              <p className="text-[10px]" style={{ color: T.textMuted }}>
                Prompt → files → build → preview
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              [FolderGit2, "Workspace", "Inspect and edit project files"],
              [Play, "Build", "Run verified build commands"],
              [Eye, "Preview", "Open the live result"],
            ].map(([Icon, title, copy]) => {
              const I = Icon as typeof Code2;
              return (
                <div
                  key={String(title)}
                  className="rounded-xl border border-white/10 bg-white/[0.035] p-3"
                >
                  <I
                    size={15}
                    className="mb-2"
                    style={{ color: T.accentColor }}
                  />
                  <p className="text-xs font-bold">{String(title)}</p>
                  <p
                    className="mt-1 text-[10px]"
                    style={{ color: T.textMuted }}
                  >
                    {String(copy)}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-center">
            <p className="text-xs font-bold">
              Builder workspace is connected to the Studio shell.
            </p>
            <p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>
              Use the command dock to describe what to build. File writes and
              dependency installs remain approval-gated.
            </p>
          </div>
        </section>
        <aside className="rounded-2xl border border-white/10 bg-black/30 p-4">
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
            Repository, terminal, agents, media tools, and deployment live in
            one operating surface.
          </p>
          <Link
            href="/code"
            className="mt-4 inline-flex rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold"
          >
            Open full code workspace
          </Link>
        </aside>
      </div>
    </div>
  );
}
