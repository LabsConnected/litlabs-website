"use client";

import { useState } from "react";
import {
  Eye,
  FileText,
  Terminal,
  Layers,
  Image as ImageIcon,
  Download,
  ExternalLink,
  FileDiff,
  GitBranch,
} from "lucide-react";

type OutputType = "preview" | "artifact" | "files" | "changes" | "logs";

export function OutputPanel({
  logs,
  selectedFile,
  files = [],
  artifact,
  onSelectFileAction,
}: {
  logs: string[];
  selectedFile: string | null;
  files?: string[];
  artifact?: {
    type: "image" | "video" | "file";
    url: string;
    title: string;
    downloadUrl?: string;
  } | null;
  onSelectFileAction?: (file: string) => void;
}) {
  const OUTPUTS = [
    { id: "preview" as const, label: "Preview", icon: Eye },
    ...(artifact
      ? [
          {
            id: "artifact" as const,
            label:
              artifact.type === "image"
                ? "Image"
                : artifact.type === "video"
                  ? "Video"
                  : "Artifact",
            icon: artifact.type === "image" ? ImageIcon : FileText,
          },
        ]
      : []),
    { id: "files" as const, label: "Files", icon: FileText },
    { id: "changes" as const, label: "Changes", icon: FileDiff },
    { id: "logs" as const, label: "Logs", icon: Terminal },
  ];
  const [active, setActive] = useState<OutputType>(
    artifact ? "artifact" : "preview",
  );

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

        {active === "preview" && artifact && artifact.type !== "file" && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            {artifact.type === "image" ? (
              <img
                src={artifact.url}
                alt={artifact.title}
                className="max-h-full w-auto rounded-xl border border-neutral-800/60 object-contain"
              />
            ) : (
              <video
                src={artifact.url}
                controls
                className="max-h-full w-auto rounded-xl border border-neutral-800/60"
              />
            )}
          </div>
        )}

        {active === "artifact" && artifact && (
          <div className="flex h-full flex-col gap-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              {artifact.title}
            </div>
            {artifact.type === "image" ? (
              <img
                src={artifact.url}
                alt={artifact.title}
                className="w-full rounded-xl border border-neutral-800/60 object-contain"
              />
            ) : artifact.type === "video" ? (
              <video
                src={artifact.url}
                controls
                className="w-full rounded-xl border border-neutral-800/60"
              />
            ) : (
              <div className="rounded-xl border border-neutral-800/60 bg-neutral-950 p-3 text-xs text-neutral-300">
                {artifact.url}
              </div>
            )}
            <div className="flex gap-2">
              {artifact.downloadUrl && (
                <a
                  href={artifact.downloadUrl}
                  download
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-3 py-2 text-[10px] font-bold text-neutral-300 transition hover:bg-neutral-800/60"
                >
                  <Download size={12} /> Download
                </a>
              )}
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-3 py-2 text-[10px] font-bold text-neutral-300 transition hover:bg-neutral-800/60"
              >
                <ExternalLink size={12} /> Open Full Size
              </a>
            </div>
          </div>
        )}

        {active === "files" && (
          <div className="space-y-1">
            {files.length === 0 ? (
              <div className="text-xs text-neutral-500">
                No files scanned yet.
              </div>
            ) : (
              files.map((f) => (
                <button
                  key={f}
                  onClick={() => onSelectFileAction?.(f)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium transition ${
                    selectedFile === f
                      ? "bg-cyan-500/10 text-cyan-300"
                      : "text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-200"
                  }`}
                >
                  <FileText size={12} />
                  <span className="truncate">{f}</span>
                </button>
              ))
            )}
          </div>
        )}

        {active === "changes" && (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800/60 bg-neutral-900/20 text-neutral-500">
            <GitBranch size={28} className="mb-2 opacity-40" />
            <div className="text-xs font-semibold">No changes yet</div>
            <div className="text-[10px]">
              Start building to create file changes.
            </div>
          </div>
        )}

        {active === "logs" && (
          <div className="space-y-1 font-mono text-[10px] leading-4 text-neutral-400">
            {logs.length === 0 ? (
              <div className="text-neutral-500">No logs yet.</div>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="border-l-2 border-neutral-800/60 pl-2">
                  {entry}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
