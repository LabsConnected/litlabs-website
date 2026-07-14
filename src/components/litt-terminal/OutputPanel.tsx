"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  FileText,
  Image as ImageIcon,
  Terminal,
  Layers,
  GitCompareArrows,
  Download,
  ExternalLink,
} from "lucide-react";

export type WorkspaceArtifact = {
  id: string;
  type: "image";
  name: string;
  url: string;
  prompt: string;
  provider: string;
  width?: number;
  height?: number;
};

type OutputType = "preview" | "artifact" | "files" | "changes" | "logs";

const OUTPUTS = [
  { id: "preview" as const, label: "Preview", icon: Eye },
  { id: "artifact" as const, label: "Artifact", icon: ImageIcon },
  { id: "files" as const, label: "Files", icon: FileText },
  { id: "changes" as const, label: "Changes", icon: GitCompareArrows },
  { id: "logs" as const, label: "Logs", icon: Terminal },
];

export function OutputPanel({
  logs,
  selectedFile,
  files = [],
  artifact,
}: {
  logs: string[];
  selectedFile: string | null;
  files?: string[];
  artifact?: WorkspaceArtifact | null;
}) {
  const [active, setActive] = useState<OutputType>("preview");

  useEffect(() => {
    if (artifact) setActive("artifact");
  }, [artifact]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Layers size={14} className="text-cyan-400" />
          <span className="text-xs font-black uppercase tracking-widest text-cyan-300">
            Workspace Output
          </span>
        </div>
      </div>

      <div className="flex border-b border-neutral-800/60">
        {OUTPUTS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase transition-all ${
                active === tab.id
                  ? "bg-cyan-500/10 text-cyan-300 border-b-2 border-cyan-400"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <Icon size={12} /> {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 p-3 overflow-y-auto">
        {active === "preview" && !artifact && (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800/60 bg-neutral-900/20 text-neutral-500">
            <ImageIcon
              size={28}
              className="mb-2 opacity-40"
              aria-label="Preview placeholder"
            />
            <div className="text-xs font-semibold">No preview yet</div>
            <div className="text-[10px]">
              Run a command or ask LiTT to generate something.
            </div>
          </div>
        )}

        {active === "preview" && artifact && (
          <div className="flex h-full items-center justify-center overflow-hidden rounded-xl border border-neutral-800/60 bg-neutral-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artifact.url} alt={artifact.prompt} className="h-full w-full object-contain" />
          </div>
        )}

        {active === "artifact" && (
          artifact ? (
            <div className="overflow-hidden rounded-xl border border-fuchsia-500/25 bg-neutral-950">
              <div className="aspect-square bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artifact.url} alt={artifact.prompt} className="h-full w-full object-contain" />
              </div>
              <div className="space-y-3 p-3">
                <div><div className="text-sm font-bold text-white">{artifact.name}</div><div className="text-[10px] text-neutral-500">{artifact.width || 1024} × {artifact.height || 1024} • {artifact.provider}</div></div>
                <p className="line-clamp-2 text-[10px] text-neutral-400">{artifact.prompt}</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={artifact.url} download={`${artifact.name}.png`} className="flex items-center justify-center gap-1 rounded-lg bg-cyan-500/15 px-2 py-2 text-[10px] font-bold text-cyan-300"><Download size={12} /> Download</a>
                  <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 rounded-lg bg-fuchsia-500/15 px-2 py-2 text-[10px] font-bold text-fuchsia-300"><ExternalLink size={12} /> Open full size</a>
                </div>
              </div>
            </div>
          ) : <div className="text-[10px] text-neutral-500">No artifact selected.</div>
        )}

        {active === "files" && (
          <div className="space-y-1.5">
            {selectedFile ? (
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1.5 text-[10px] text-cyan-200">
                {selectedFile}
              </div>
            ) : null}
            {files.length === 0 ? (
              <div className="text-[10px] text-neutral-500">
                No files scanned yet.
              </div>
            ) : (
              files.slice(0, 20).map((f) => (
                <div
                  key={f}
                  className="flex items-center gap-2 rounded-lg border border-neutral-800/40 bg-neutral-900/30 px-2.5 py-1.5 text-[10px] text-neutral-300 hover:bg-neutral-800/40 transition"
                >
                  <FileText size={12} className="text-neutral-500" /> {f}
                </div>
              ))
            )}
          </div>
        )}

        {active === "logs" && (
          <div className="space-y-1 font-mono text-[9px]">
            {logs.length === 0 ? (
              <div className="text-neutral-500">No logs yet.</div>
            ) : null}
            {logs.slice(-30).map((log, i) => (
              <div key={i} className="break-all text-neutral-300">
                <span className="text-neutral-600">
                  {new Date().toLocaleTimeString([], {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>{" "}
                {log}
              </div>
            ))}
          </div>
        )}

        {active === "changes" && (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800/60 bg-neutral-900/20 text-center">
            <GitCompareArrows size={24} className="mb-2 text-neutral-600" />
            <div className="text-xs font-semibold text-neutral-400">No file changes yet</div>
            <div className="mt-1 max-w-48 text-[10px] text-neutral-600">Generated project edits will appear here for review before commit.</div>
          </div>
        )}
      </div>
    </div>
  );
}
