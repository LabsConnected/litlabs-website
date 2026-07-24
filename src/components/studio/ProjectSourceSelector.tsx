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
  const sources: Array<{ icon: typeof FolderGit2; type: ProjectSource["type"]; label: string; desc: string }> = [
    { icon: FolderGit2, type: "github", label: "GitHub", desc: "Clone a repository" },
    { icon: Upload, type: "upload", label: "Upload", desc: "Import files" },
    { icon: FileCode, type: "template", label: "Template", desc: "Start from a template" },
    { icon: Sparkles, type: "generate", label: "AI Generate", desc: "Generate from a prompt" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {sources.map(({ icon: Icon, type, label, desc }) => (
        <button
          key={label}
          onClick={() => onSelected?.({ type, label })}
          className="flex flex-col items-start gap-1 rounded-xl border border-white/10 bg-white/3 p-3 text-left transition hover:border-cyan-300/30 hover:bg-white/5"
        >
          <Icon size={16} className="text-cyan-300" />
          <span className="text-[10px] font-bold text-white">{label}</span>
          <span className="text-[9px] text-white/40">{desc}</span>
        </button>
      ))}
    </div>
  );
}
