"use client";

import { useEffect, useState, useCallback } from "react";
import { ChatTerminal } from "./ChatTerminal";
import { OutputPanel, type WorkspaceArtifact } from "./OutputPanel";
import { CheckCircle2, GitBranch, PanelRight, Palette } from "lucide-react";

const WALLPAPERS = [
  "radial-gradient(circle at 20% 15%, rgba(6,182,212,.20), transparent 34%), radial-gradient(circle at 78% 30%, rgba(168,85,247,.17), transparent 38%), linear-gradient(135deg,#020617,#080312 62%,#02040a)",
  "radial-gradient(circle at 50% 5%, rgba(249,115,22,.18), transparent 32%), radial-gradient(circle at 15% 80%, rgba(236,72,153,.14), transparent 34%), linear-gradient(145deg,#090402,#10020c 55%,#020617)",
  "radial-gradient(circle at 70% 18%, rgba(34,197,94,.16), transparent 30%), radial-gradient(circle at 25% 65%, rgba(14,165,233,.18), transparent 38%), linear-gradient(145deg,#010807,#020617 58%,#07020e)",
];

export function LiTTTerminalPage() {
  const [logs, setLogs] = useState<string[]>([
    "[SYSTEM] LiTT Code Mission Control initialized",
    "[SYSTEM] Agent swarm standing by...",
  ]);
  const [connected, setConnected] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<WorkspaceArtifact | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState("Mission");
  const [contextOpen, setContextOpen] = useState(true);
  const [wallpaper, setWallpaper] = useState(() => {
    if (typeof window === "undefined") return 0;
    const saved = Number(
      window.localStorage.getItem("litt-workspace-wallpaper"),
    );
    return Number.isInteger(saved) && saved >= 0 && saved < WALLPAPERS.length
      ? saved
      : 0;
  });

  const cycleWallpaper = () => {
    setWallpaper((current) => {
      const next = (current + 1) % WALLPAPERS.length;
      window.localStorage.setItem("litt-workspace-wallpaper", String(next));
      return next;
    });
  };

  const addLog = (entry: string) =>
    setLogs((prev) => [...prev.slice(-99), entry]);

  const loadFileTree = useCallback(async () => {
    try {
      const res = await fetch("/api/litt/scan");
      const data = await res.json();
      const scanned = Array.isArray(data.files)
        ? data.files.map((f: { path?: string }) => f.path || "").filter(Boolean)
        : [];
      if (scanned.length) {
        setFiles(scanned);
        setSelectedFile(scanned[0] || null);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await loadFileTree();
    })();
    return () => {
      active = false;
    };
  }, [loadFileTree]);

  return (
    <main
      className="h-full min-h-0 w-full max-w-full overflow-hidden bg-[#050505] text-white selection:bg-cyan-500/30"
      style={{ background: WALLPAPERS[wallpaper] }}
    >
      {/* Holographic background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-size-[40px_40px] mask-[radial-gradient(circle_at_center,black_30%,transparent_80%)]" />
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-[120px]" />
      </div>

      <div
        className={`relative z-10 grid h-full min-h-0 w-full max-w-full grid-cols-1 overflow-hidden ${contextOpen ? "lg:grid-cols-[minmax(0,1fr)_minmax(320px,25vw)]" : "lg:grid-cols-1"}`}
      >
        <section className="flex min-w-0 max-w-full flex-col overflow-hidden border-x border-neutral-800/40">
          <header className="border-b border-neutral-800/40 px-3 pt-3 backdrop-blur-md sm:px-4">
            <div className="flex min-w-0 items-center justify-between gap-3 pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-bold text-neutral-500">
                  <span className="text-cyan-400">LiTT Code</span>
                  <span>/</span>
                  <GitBranch size={11} />
                  <span>active workspace</span>
                </div>
                <h1 className="mt-1 truncate text-lg font-black text-white lg:text-xl">
                  Project Mission
                </h1>
              </div>
              <div className="flex items-center gap-2 text-[9px] font-bold uppercase">
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-1 ${connected ? "bg-green-500/10 text-green-400" : "bg-neutral-800 text-neutral-400"}`}
                >
                  <CheckCircle2 size={11} />{" "}
                  {connected ? "Terminal live" : "Workspace ready"}
                </span>
                <button
                  onClick={cycleWallpaper}
                  className="rounded-lg border border-neutral-800 p-2 text-neutral-400"
                  aria-label="Change wallpaper"
                >
                  <Palette size={14} />
                </button>
                <button
                  onClick={() => setContextOpen((value) => !value)}
                  className="rounded-lg border border-neutral-800 p-2 text-neutral-400"
                >
                  <PanelRight size={14} />
                </button>
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {["Mission", "Files", "Changes", "Memory", "Activity"].map(
                (tab) => (
                  <button
                    key={tab}
                    onClick={() => setWorkspaceTab(tab)}
                    className={`border-b-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${workspaceTab === tab ? "border-cyan-400 text-cyan-300" : "border-transparent text-neutral-500"}`}
                  >
                    {tab}
                  </button>
                ),
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
            <ChatTerminal
              agentId="director"
              onLogAction={addLog}
              onCommandAction={addLog}
              onConnectionChangeAction={setConnected}
              onTerminalOutputAction={() => undefined}
              onArtifactAction={setArtifact}
            />
          </div>
        </section>

        {contextOpen && (
          <aside className="hidden min-h-0 min-w-0 overflow-hidden border-l border-neutral-800/40 p-2 lg:block xl:p-3">
            <div className="h-full min-h-0">
              <OutputPanel
                logs={logs}
                selectedFile={selectedFile}
                files={files}
                artifact={artifact}
              />
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
