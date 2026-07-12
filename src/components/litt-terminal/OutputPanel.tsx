"use client";

import { useState } from "react";
import {
  Eye,
  Code,
  FileText,
  Globe,
  Image as ImageIcon,
  Terminal,
  Layers,
} from "lucide-react";

type OutputType = "preview" | "media" | "code" | "files" | "logs" | "browser";

export function OutputPanel({
  logs,
  selectedFile,
  files = [],
  media,
}: {
  logs: string[];
  selectedFile: string | null;
  files?: string[];
  media?: { type: "image" | "video"; url: string; title: string } | null;
}) {
  const OUTPUTS = [
    { id: "preview" as const, label: "Preview", icon: Eye },
    ...(media
      ? [
          {
            id: "media" as const,
            label: media.type === "video" ? "Video" : "Image",
            icon: ImageIcon,
          },
        ]
      : []),
    { id: "code" as const, label: "Code", icon: Code },
    { id: "files" as const, label: "Files", icon: FileText },
    { id: "logs" as const, label: "Logs", icon: Terminal },
    { id: "browser" as const, label: "Browser", icon: Globe },
  ];
  const [active, setActive] = useState<OutputType>("preview");

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
        {active === "preview" && !media && (
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

        {active === "media" && media && (
          <div className="flex h-full flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              {media.title}
            </div>
            {media.type === "image" ? (
              <img
                src={media.url}
                alt={media.title}
                className="max-h-full w-auto rounded-xl border border-neutral-800/60 object-contain"
              />
            ) : (
              <video
                src={media.url}
                controls
                className="max-h-full w-auto rounded-xl border border-neutral-800/60"
              />
            )}
          </div>
        )}

        {active === "code" && (
          <div className="rounded-xl border border-neutral-800/60 bg-neutral-950 p-3 font-mono text-[10px] text-neutral-300 space-y-1">
            <div className="text-neutral-500">
              {"// Generated code will appear here"}
            </div>
            <div>
              <span className="text-cyan-400">export default</span>{" "}
              <span className="text-fuchsia-400">function</span>{" "}
              <span className="text-yellow-300">App</span>() {"{"}
            </div>
            <div className="pl-3 text-neutral-400">
              return &lt;div&gt;Hello LiTT&lt;/div&gt;;
            </div>
            <div>{"}"}</div>
          </div>
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

        {active === "browser" && (
          <div className="flex h-full flex-col rounded-xl border border-neutral-800/60 bg-neutral-900/20">
            <div className="flex items-center gap-2 border-b border-neutral-800/40 px-2 py-1.5">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500/60" />
                <span className="h-2 w-2 rounded-full bg-amber-500/60" />
                <span className="h-2 w-2 rounded-full bg-green-500/60" />
              </div>
              <div className="flex-1 rounded-md bg-neutral-900/60 px-2 py-0.5 text-[9px] text-neutral-500">
                https://localhost:3000
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center text-neutral-500">
              <div className="text-center">
                <Globe size={24} className="mx-auto mb-2 opacity-40" />
                <div className="text-[10px]">Live browser preview</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
