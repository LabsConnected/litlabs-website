"use client";

import { FolderGit2, Upload, FileCode, Sparkles } from "lucide-react";

export interface ProjectSource {
  type: "github" | "upload" | "template" | "generate";
  label: string;
  data?: Record<string, unknown>;
}

export default function ProjectSourceSelector({
  onSelected,
}: {
  onSelected?: (src: ProjectSource) => void;
}) {
  // "upload" is disabled until a real upload backend exists — no consumer
  // currently has one (POST /api/project-sources/upload was never built),
  // so offering it would be a dead end. Marked honestly instead of removed
  // so the roadmap stays visible.
  const sources: Array<{ icon: typeof FolderGit2; type: ProjectSource["type"]; label: string; desc: string; disabled?: boolean }> = [
    { icon: FolderGit2, type: "github", label: "GitHub", desc: "Clone a repository" },
    { icon: Upload, type: "upload", label: "Upload", desc: "Import files", disabled: true },
    { icon: FileCode, type: "template", label: "Template", desc: "Start from a template" },
    { icon: Sparkles, type: "generate", label: "AI Generate", desc: "Generate from a prompt" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {sources.map(({ icon: Icon, type, label, desc, disabled }) => (
        <button
          key={label}
          disabled={disabled}
          onClick={() => onSelected?.({ type, label })}
          className="flex flex-col items-start gap-1 rounded-xl border border-white/10 bg-white/3 p-3 text-left transition hover:border-accent/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/3"
        >
          <Icon size={16} className="text-accent" />
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-white">
            {label}
            {disabled && (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white/50">
                Soon
              </span>
            )}
          </span>
          <span className="text-[9px] text-white/40">{desc}</span>
        </button>
      ))}
    </div>
  );
}
