"use client";

import { useState } from "react";
import {
  Hammer,
  Play,
  Rocket,
  FileCode,
  Folder,
  Loader2,
  Terminal,
} from "lucide-react";

type ScanData = {
  projectName?: string;
  totalFiles?: number;
  totalLines?: number;
  techStack?: string[];
  routes?: string[];
  apiEndpoints?: string[];
  agents?: string[];
  recentChanges?: string[];
  health?: {
    envVarsConfigured?: number;
    envVarsMissing?: string[];
    buildStatus?: string;
  };
};

export function BuilderPanel({
  files,
  selectedFile,
  onSelectFileAction,
  onDeployAction,
  logs,
}: {
  files: string[];
  selectedFile: string | null;
  onSelectFileAction: (file: string) => void;
  onDeployAction: () => void;
  logs: string[];
}) {
  const [scan, setScan] = useState<ScanData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildOutput, setBuildOutput] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/litt/scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setScan(data);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const runBuild = async () => {
    setBuilding(true);
    setError(null);
    setBuildOutput(["Starting production build…"]);
    try {
      const res = await fetch("/api/litt/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "build" }),
      });
      const data = (await res.json()) as {
        output?: string;
        error?: string;
        durationMs?: number;
      };
      const output = data.output?.split(/\r?\n/).filter(Boolean) ?? [];
      setBuildOutput([
        ...output,
        res.ok
          ? `Build passed in ${Math.round((data.durationMs ?? 0) / 1000)}s`
          : data.error || "Build failed",
      ]);
      if (!res.ok) throw new Error(data.error || "Build failed");
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-neutral-800/60 bg-black/40 p-3 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2">
        <Hammer size={16} className="text-cyan-400" />
        <span className="text-xs font-black uppercase tracking-widest text-cyan-300">
          Builder
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
          {error}
        </div>
      ) : null}

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={runScan}
          disabled={scanning}
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-2 text-[10px] font-bold text-neutral-200 transition hover:bg-white/5 disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Folder size={14} className="text-cyan-300" />
          )}
          Scan
        </button>
        <button
          onClick={runBuild}
          disabled={building}
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-2 text-[10px] font-bold text-neutral-200 transition hover:bg-white/5 disabled:opacity-50"
        >
          {building ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} className="text-green-300" />
          )}
          Build
        </button>
        <button
          onClick={onDeployAction}
          className="flex flex-col items-center gap-1 rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-2 text-[10px] font-bold text-neutral-200 transition hover:bg-white/5"
        >
          <Rocket size={14} className="text-fuchsia-300" />
          Deploy
        </button>
      </div>

      {/* Project stats */}
      {scan ? (
        <div className="space-y-2 rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-2.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-neutral-500">Files</span>
            <span className="font-bold text-cyan-300">
              {scan.totalFiles ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-neutral-500">Lines</span>
            <span className="font-bold text-cyan-300">
              {scan.totalLines ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-neutral-500">Status</span>
            <span className="font-bold text-green-300">
              {scan.health?.buildStatus || "Ready"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {(scan.techStack || []).slice(0, 5).map((tech) => (
              <span
                key={tech}
                className="rounded-md border border-neutral-700/50 bg-neutral-800/50 px-1.5 py-0.5 text-[9px] font-semibold text-neutral-300"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* File tree */}
      <div className="flex flex-1 min-h-0 flex-col gap-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500">
          Files
        </div>
        <div className="flex-1 min-h-0 space-y-1 overflow-y-auto rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-2">
          {files.length === 0 ? (
            <div className="text-[10px] text-neutral-500">
              No files scanned yet.
            </div>
          ) : (
            files.slice(0, 40).map((f) => {
              const active = selectedFile === f;
              return (
                <button
                  key={f}
                  onClick={() => onSelectFileAction(f)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[10px] transition ${
                    active
                      ? "bg-cyan-500/10 text-cyan-200 border border-cyan-500/30"
                      : "text-neutral-300 hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <FileCode
                    size={12}
                    className={active ? "text-cyan-300" : "text-neutral-500"}
                  />
                  <span className="truncate">{f}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Build log */}
      <div className="flex h-[140px] flex-col gap-2">
        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-neutral-500">
          <Terminal size={12} />
          Build log
        </div>
        <div className="flex-1 min-h-0 space-y-1 overflow-y-auto rounded-xl border border-neutral-800/60 bg-neutral-950 p-2 font-mono text-[9px] text-neutral-300">
          {logs.length === 0 && buildOutput.length === 0 ? (
            <div className="text-neutral-500">No build output yet.</div>
          ) : (
            [...logs, ...buildOutput].slice(-12).map((log, i) => (
              <div key={i} className="break-all">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
