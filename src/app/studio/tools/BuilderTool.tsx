"use client";

import { Code2, Eye, FolderGit2, Play } from "lucide-react";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";
import PreviewPanel from "@/components/studio/PreviewPanel";
import ProjectSourceSelector from "@/components/studio/ProjectSourceSelector";

export default function BuilderTool() {
  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 overflow-auto">
      <SystemTopologyPanel />
      <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Code2 size={16} className="text-cyan-300" />
            <div>
              <p className="text-xs font-black uppercase tracking-wider">
                AI Studio
              </p>
              <p className="text-[10px] text-white/50">
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
                  <I size={15} className="mb-2 text-cyan-300" />
                  <p className="text-xs font-bold">{String(title)}</p>
                  <p className="mt-1 text-[10px] text-white/50">
                    {String(copy)}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-center">
            <p className="text-xs font-bold">
              Connect a project to start building.
            </p>
            <p className="mt-1 text-[10px] text-white/50">
              Choose a repository and branch below. Once the runtime is online,
              LiTT can inspect files, run approved commands, and open a preview.
            </p>
          </div>
        </section>
        <aside className="space-y-3">
          <PreviewPanel />
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">
              Project
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-white/55">
              Select a project source to start building.
            </p>
            <button
              onClick={() => {
                const evt = new CustomEvent("studio:switch-tool", {
                  detail: "code",
                });
                if (typeof window !== "undefined") {
                  window.dispatchEvent(evt);
                }
              }}
              className="mt-4 inline-flex rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold"
            >
              Open code workspace
            </button>
          </div>
        </aside>
      </div>
      <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="mb-4">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">
            Project source
          </p>
          <h3 className="mt-1 text-sm font-black">Choose how to start your project</h3>
          <p className="mt-1 text-[10px] text-white/50">
            GitHub, upload, template, or blank — this is the real project source used by Studio.
          </p>
        </div>
        <ProjectSourceSelector />
      </section>
    </div>
  );
}
