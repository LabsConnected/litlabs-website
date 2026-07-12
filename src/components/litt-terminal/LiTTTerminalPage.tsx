"use client";

import { useEffect, useState, useCallback } from "react";
import { AgentCommandCenter } from "./AgentCommandCenter";
import { ChatTerminal } from "./ChatTerminal";
import { BuilderPanel } from "./BuilderPanel";
import { OutputPanel } from "./OutputPanel";
import { FloatingOrb } from "./FloatingOrb";
import { Menu, MessageSquare, Hammer, Terminal, X } from "lucide-react";

export function LiTTTerminalPage() {
  const [activeCommand, setActiveCommand] = useState("terminal");
  const [logs, setLogs] = useState<string[]>([
    "[SYSTEM] LiTT Code Mission Control initialized",
    "[SYSTEM] Agent swarm standing by...",
  ]);
  const [connected, setConnected] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileBuilderOpen, setMobileBuilderOpen] = useState(false);
  const [chatMode, setChatMode] = useState<"chat" | "terminal">("chat");
  const [media, setMedia] = useState<{
    type: "image" | "video";
    url: string;
    title: string;
  } | null>(null);
  const [orbState, setOrbState] = useState<
    "idle" | "thinking" | "working" | "listening" | "success"
  >("idle");

  const addLog = (entry: string) =>
    setLogs((prev) => [...prev.slice(-99), entry]);

  const handleDeploy = useCallback(async () => {
    addLog("[DEPLOY] Triggering production deploy...");
    setOrbState("working");
    try {
      const res = await fetch("/api/deploy/trigger", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        addLog(`[DEPLOY] Deploy started: ${data.id}`);
      } else {
        addLog(`[DEPLOY] Failed: ${data.error || res.statusText}`);
      }
    } catch (err) {
      addLog(
        `[DEPLOY] Error: ${err instanceof Error ? err.message : "Failed"}`,
      );
    } finally {
      setOrbState("success");
      setTimeout(() => setOrbState("idle"), 2000);
    }
  }, []);

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
    <main className="h-full min-h-0 overflow-x-hidden bg-[#050505] text-white selection:bg-cyan-500/30">
      {/* Holographic background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-size-[40px_40px] mask-[radial-gradient(circle_at_center,black_30%,transparent_80%)]" />
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 grid h-full min-w-0 max-w-full grid-cols-1 overflow-hidden lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(320px,420px)]">
        {/* Mobile overlay */}
        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* Left: AI Command Center */}
        <div
          className={`fixed inset-y-0 left-0 z-50 min-w-0 w-[260px] transform transition-transform duration-200 lg:static lg:transform-none lg:min-w-0 ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
        >
          <AgentCommandCenter
            activeId={activeCommand}
            onSelect={setActiveCommand}
            onDeploy={handleDeploy}
          />
        </div>

        {/* Center: Chat + Terminal */}
        <section className="flex min-w-0 max-w-full flex-col overflow-hidden border-x border-neutral-800/40">
          <header className="flex min-w-0 items-center justify-between gap-2 border-b border-neutral-800/40 px-3 py-3 backdrop-blur-md sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="rounded-lg border border-neutral-700/50 p-2 text-neutral-400 hover:bg-neutral-800/50 lg:hidden"
                onClick={() => setMobileSidebarOpen((open) => !open)}
                aria-label="Toggle menu"
              >
                <Menu size={18} />
              </button>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-400">
                  LiTT Code
                </div>
                <h1 className="truncate text-lg font-bold lg:text-xl">
                  Director Console
                </h1>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-[9px] font-bold uppercase tracking-wider sm:gap-2 sm:text-[10px]">
              <span className="flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
                Online
              </span>
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-400">
                {connected ? "WS Live" : "WS Standby"}
              </span>
            </div>
          </header>

          <div className="min-h-0 flex-1 p-2 pb-[calc(env(safe-area-inset-bottom)+84px)] sm:p-3 sm:pb-3">
            <ChatTerminal
              agentId="director"
              mode={chatMode}
              onModeChangeAction={setChatMode}
              onLogAction={addLog}
              onCommandAction={addLog}
              onConnectionChangeAction={setConnected}
              onTerminalOutputAction={() => setOrbState("working")}
              onMediaGeneratedAction={(m) => setMedia(m)}
            />
          </div>
        </section>

        {/* Right: Builder + Output */}
        <aside className="hidden min-w-0 flex-col gap-3 overflow-y-auto border-l border-neutral-800/40 p-3 lg:flex">
          <BuilderPanel
            files={files}
            selectedFile={selectedFile}
            onSelectFileAction={setSelectedFile}
            onDeployAction={handleDeploy}
            logs={logs}
          />
          <div className="flex-1 min-h-[280px]">
            <OutputPanel
              logs={logs}
              selectedFile={selectedFile}
              files={files}
              media={media}
            />
          </div>
        </aside>
      </div>

      {/* Mobile builder sheet */}
      {mobileBuilderOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileBuilderOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 h-[75dvh] rounded-t-2xl border-t border-neutral-700/50 bg-[#060606] p-3 lg:hidden">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-widest text-cyan-300">
                Builder
              </span>
              <button
                onClick={() => setMobileBuilderOpen(false)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10"
                aria-label="Close builder"
              >
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-40px)]">
              <BuilderPanel
                files={files}
                selectedFile={selectedFile}
                onSelectFileAction={setSelectedFile}
                onDeployAction={handleDeploy}
                logs={logs}
              />
            </div>
          </div>
        </>
      )}

      {/* Mobile bottom tab bar: Builder / Chat / Terminal */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-neutral-800/60 bg-[#060606]/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur-md lg:hidden">
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => setChatMode("chat")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider transition ${
              chatMode === "chat"
                ? "bg-cyan-500/15 text-cyan-300"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <MessageSquare size={15} />
            Chat
          </button>
          <button
            onClick={() => setMobileBuilderOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400 transition hover:bg-white/5 hover:text-neutral-200"
          >
            <Hammer size={15} />
            Builder
          </button>
          <button
            onClick={() => setChatMode("terminal")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider transition ${
              chatMode === "terminal"
                ? "bg-orange-500/15 text-orange-300"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Terminal size={15} />
            Terminal
          </button>
        </div>
      </nav>

      <FloatingOrb state={orbState} />
    </main>
  );
}
