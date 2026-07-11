"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { TerminalPanel, TerminalPanelHandle } from "./TerminalPanel";
import { LiTTAssistantPanel } from "./LiTTAssistantPanel";
import { LogsPanel } from "./LogsPanel";
import { CommandHistory } from "./CommandHistory";
import { FileExplorer } from "./FileExplorer";
import { CodeEditor } from "./CodeEditor";
import { DeployButton } from "./DeployButton";
import { LeftSidebar } from "./LeftSidebar";
import { Cpu, Activity, Zap, Menu, RefreshCw, AlertTriangle } from "lucide-react";
import { JarvisContext } from "@/lib/litt-context";

const AGENTS = [
  { name: "LiTT", status: "online" as const },
  { name: "Code Architect", status: "idle" as const },
  { name: "DevOps Engineer", status: "idle" as const },
  { name: "Security Auditor", status: "idle" as const },
  { name: "Growth Strategist", status: "idle" as const },
  { name: "Data Slayer", status: "idle" as const },
];

export function LiTTTerminalPage() {
  const [activeTab, setActiveTab] = useState<"terminal" | "agents" | "logs">("terminal");
  const [logs, setLogs] = useState<string[]>([
    "[SYSTEM] LiTT Code Terminal initialized",
    "[SYSTEM] Waiting for terminal server connection...",
  ]);
  const [commands, setCommands] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [usage, setUsage] = useState<{ allowed: boolean; used: number; limit: number; role?: string } | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalPanelHandle>(null);

  const addLog = (entry: string) => {
    setLogs((prev) => [...prev.slice(-99), entry]);
  };

  const addCommand = (cmd: string) => {
    setCommands((prev) => [...prev.slice(-49), cmd]);
  };

  const loadFileTree = useCallback(async () => {
    try {
      const res = await fetch("/api/litt/scan");
      const data = await res.json();
      if (Array.isArray(data.files)) {
        setFileTree(data.files.slice(0, 50));
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/usage/check")
      .then((res) => res.json())
      .then((data) => {
        if (active && data) {
          setUsage(data);
        }
      })
      .catch(() => {});
    (async () => {
      if (active) await loadFileTree();
    })();
    return () => {
      active = false;
    };
  }, [loadFileTree]);

  const context: JarvisContext = {
    route: "/litt",
    terminalOutput,
    commandHistory: commands,
    logs,
    selectedFile: selectedFile ? { path: selectedFile, content: fileContent } : undefined,
    fileTree,
    agents: AGENTS.map((a) => ({ name: a.name, status: a.status })),
    websocketStatus: connected ? "connected" : terminalOutput ? "offline" : "connecting",
  };

  const handleInsertCommand = (cmd: string) => {
    terminalRef.current?.insertCommand(cmd);
  };

  const handleRunCommand = (cmd: string) => {
    terminalRef.current?.runCommand(cmd);
  };

  const handleCreateFile = async (path: string, content: string) => {
    try {
      const res = await fetch(`/api/terminal/files/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      addLog(`[FILE] Created ${path}`);
    } catch (err) {
      addLog(`[ERROR] Failed to create ${path}: ${err instanceof Error ? err.message : ""}`);
    }
  };

  const handleStartAgent = (name: string) => {
    addLog(`[AGENT] Starting ${name}...`);
  };

  const handleDeploy = () => {
    addLog("[DEPLOY] Deployment requested via LiTT");
  };

  const wsUrl = process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "http://localhost:4001";

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_1fr_420px]">
        <LeftSidebar mobileOpen={mobileSidebarOpen} />

        {mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        <section className="flex flex-col border-x border-neutral-900">
          <header className="flex flex-col gap-4 border-b border-neutral-900 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg border border-neutral-800 p-2 text-neutral-400 hover:bg-neutral-900 lg:hidden"
                onClick={() => setMobileSidebarOpen((open) => !open)}
                aria-label="Toggle menu"
              >
                <Menu size={20} />
              </button>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.35em] text-orange-500">
                  LiTT Code LabStudios
                </div>
                <h1 className="text-2xl font-bold lg:text-3xl">LiTT Terminal</h1>
                <p className="text-sm text-neutral-400">
                  AI Dev OS • Build, Ship, Scale.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Status label="System" value="Operational" icon={Activity} color="text-green-400" />
              <Status label="Agents" value="3 / 6" icon={Cpu} color="text-orange-400" />
              <Status label="CPU" value="18%" icon={Zap} color="text-blue-400" />
              <div
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  connected ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                }`}
              >
                {connected ? "WebSocket Live" : "WebSocket Offline"}
              </div>
              {usage && (
                <div
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    usage.allowed ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {usage.role === "admin" ? "Unlimited" : `${usage.used}/${usage.limit} cmds/hr`}
                </div>
              )}
              <DeployButton />
            </div>
          </header>

          {connectionError && (
            <div className="border-b border-red-900/30 bg-red-900/20 px-6 py-2 text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              {connectionError}
              <button
                onClick={() => window.location.reload()}
                className="ml-auto flex items-center gap-1 rounded bg-red-600/20 px-2 py-1 font-bold hover:bg-red-600/40"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}

          <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[240px_1fr_1fr]">
            <FileExplorer onOpenFile={setSelectedFile} />

            <div className="flex flex-col gap-4">
              <div className="h-[60vh] min-h-[420px] rounded-xl border border-neutral-800 bg-black">
                <TerminalPanel
                  ref={terminalRef}
                  onLog={addLog}
                  onCommand={addCommand}
                  onConnectionChange={(c) => {
                    setConnected(c);
                    if (!c) {
                      setConnectionError(
                        `Terminal server not connected. Check NEXT_PUBLIC_TERMINAL_WS_URL (${wsUrl}).`
                      );
                    } else {
                      setConnectionError(null);
                    }
                  }}
                  onTerminalOutput={setTerminalOutput}
                />
              </div>

              <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
                <LogsPanel logs={logs} />
                <CommandHistory commands={commands} />
              </div>
            </div>

            <div className={`hidden flex-col gap-4 lg:flex ${selectedFile ? "" : "opacity-50"}`}>
              <div className="flex-1 min-h-[300px]">
                {selectedFile ? (
                  <CodeEditor
                    filePath={selectedFile}
                    onClose={() => setSelectedFile(null)}
                    onContentChange={setFileContent}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                    <div className="text-sm">Select a file from the explorer</div>
                    <div className="text-xs">Monaco Editor will open here</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden flex-col border-l border-neutral-900 bg-[#080808] p-4 lg:flex">
          <LiTTAssistantPanel
            context={context}
            onInsertCommand={handleInsertCommand}
            onRunCommand={handleRunCommand}
            onCreateFile={handleCreateFile}
            onStartAgent={handleStartAgent}
            onDeploy={handleDeploy}
          />
        </aside>

        <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-neutral-900 bg-[#080808] lg:hidden">
          {[
            { id: "terminal", label: "Terminal" },
            { id: "agents", label: "Agents" },
            { id: "logs", label: "Logs" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 px-3 py-3 text-xs font-bold ${
                activeTab === tab.id ? "bg-orange-600/20 text-orange-400" : "text-neutral-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function Status({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-neutral-500" />
      <div>
        <div className="text-[10px] text-neutral-500">{label}</div>
        <div className={`text-xs font-semibold ${color}`}>{value}</div>
      </div>
    </div>
  );
}
