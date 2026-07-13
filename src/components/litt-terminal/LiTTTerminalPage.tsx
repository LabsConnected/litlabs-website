"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ChatTerminal } from "./ChatTerminal";
import { OutputPanel } from "./OutputPanel";
import { MissionCanvas } from "@/components/litt-director/MissionCanvas";
import {
  DirectorRuntimeProvider,
  useDirectorRuntime,
} from "@/components/litt-director/DirectorRuntime";
import { ConnectorStrip } from "./ConnectorStrip";
import { useProfile } from "@/context/ProfileContext";
import {
  WALLPAPERS,
  getWallpaperById,
  type WallpaperId,
} from "@/lib/wallpapers";
import {
  Menu,
  ChevronRight,
  ChevronLeft,
  Zap,
  FolderTree,
  GitBranch,
  History,
  Cpu,
  Upload,
} from "lucide-react";

export function LiTTTerminalPage() {
  return (
    <DirectorRuntimeProvider>
      <LiTTTerminalPageInner />
    </DirectorRuntimeProvider>
  );
}

type RightPanelTab = "context" | "output";

type ProjectRecord = {
  id: string;
  owner: string;
  repository: string;
  default_branch: string;
  working_branch: string;
  status: string;
};

type ChatTriggerMode =
  | "ask"
  | "image"
  | "build"
  | "code"
  | "agent"
  | "search"
  | "memory"
  | "deploy";

function LiTTTerminalPageInner() {
  const { activeArtifact } = useDirectorRuntime();
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [files, setFiles] = useState<{ path: string; type: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightPanelTab>("output");
  const [activeTab, setActiveTab] = useState<
    "mission" | "files" | "changes" | "memory" | "activity"
  >("mission");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [chatTrigger, setChatTrigger] = useState<{
    text: string;
    mode?:
      | "ask"
      | "image"
      | "build"
      | "code"
      | "agent"
      | "search"
      | "memory"
      | "deploy";
  } | null>(null);
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const { profile, updateProfile } = useProfile();
  const activeWallpaper = getWallpaperById(profile.wallpaper);

  const addLog = (entry: string) =>
    setLogs((prev) => [...prev.slice(-99), entry]);

  const handleDeploy = useCallback(async () => {
    addLog("[DEPLOY] Triggering preview deployment...");
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
    }
  }, []);

  const loadFileTree = useCallback(async () => {
    try {
      const res = await fetch("/api/litt/scan");
      const data = await res.json();
      const scanned = Array.isArray(data.files)
        ? data.files
            .map((f: { path?: string; type?: string }) => ({
              path: f.path || "",
              type: f.type || "",
            }))
            .filter((f: { path: string }) => f.path)
        : [];
      if (scanned.length) {
        setFiles(scanned);
        setSelectedFile(scanned[0].path || null);
      }
    } catch {
      // silent
    }
  }, []);

  const loadProject = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      const projects = Array.isArray(data?.projects) ? data.projects : [];
      if (projects.length > 0) {
        setProject(projects[0] as ProjectRecord);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) {
        await loadFileTree();
        await loadProject();
      }
    })();
    return () => {
      active = false;
    };
  }, [loadFileTree, loadProject]);

  const filePaths = useMemo(() => files.map((f) => f.path), [files]);

  const TABS = [
    { id: "mission" as const, label: "Mission", icon: Zap },
    { id: "files" as const, label: "Files", icon: FolderTree },
    { id: "changes" as const, label: "Changes", icon: GitBranch },
    { id: "memory" as const, label: "Memory", icon: Cpu },
    { id: "activity" as const, label: "Activity", icon: History },
  ];

  const handleWallpaperChange = (id: WallpaperId) => {
    updateProfile({ wallpaper: id });
  };

  const handleWallpaperUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingWallpaper(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Upload failed");
      updateProfile({ wallpaper: "custom", customWallpaperUrl: data.url });
      addLog(`[WALLPAPER] Uploaded custom wallpaper`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      addLog(`[WALLPAPER] Error: ${msg}`);
    } finally {
      setUploadingWallpaper(false);
      if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
    }
  };

  const handleStarterPrompt = useCallback(
    (starter: { id: string; prompt: string }) => {
      const modeMap: Record<string, ChatTriggerMode> = {
        image: "image",
        build: "build",
        code: "code",
        agent: "agent",
        search: "search",
        memory: "memory",
      };
      setChatTrigger({
        text: starter.prompt,
        mode: modeMap[starter.id] || "ask",
      });
    },
    [],
  );

  const wallpaperStyle: React.CSSProperties =
    profile.wallpaper === "custom" && profile.customWallpaperUrl
      ? { backgroundImage: `url(${profile.customWallpaperUrl})` }
      : activeWallpaper.fullStyle;

  return (
    <main
      className="h-full min-h-0 overflow-x-hidden text-white selection:bg-cyan-500/30"
      style={{
        backgroundColor: "#050505",
        ...wallpaperStyle,
        backgroundSize:
          wallpaperStyle.backgroundSize ||
          (profile.wallpaper === "custom" ? "cover" : undefined),
      }}
    >
      {/* Wallpaper overlay to keep workspace readable */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-black/30" />
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-size-[40px_40px] mask-[radial-gradient(circle_at_center,black_30%,transparent_80%)]" />
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 flex h-full min-w-0 flex-col">
        {/* Project header */}
        <header className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-neutral-800/40 px-3 py-2 backdrop-blur-md sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="rounded-lg border border-neutral-700/50 p-2 text-neutral-400 hover:bg-neutral-800/50"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label="Toggle menu"
            >
              <Menu size={18} />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-400">
                Project Workspace
              </div>
              <h1 className="truncate text-base font-bold sm:text-lg">
                {project
                  ? `${project.owner}/${project.repository}`
                  : "LiTTree-LabStudios"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition sm:text-[11px] ${
                    activeTab === t.id
                      ? "bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30"
                      : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                  }`}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <ConnectorStrip connected={connected} />
            <select
              value={profile.wallpaper}
              onChange={(e) =>
                handleWallpaperChange(e.target.value as WallpaperId)
              }
              aria-label="Wallpaper theme"
              className="rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-2 py-1 text-[10px] font-bold text-neutral-300 outline-none"
            >
              {WALLPAPERS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <input
              ref={wallpaperInputRef}
              type="file"
              accept="image/*"
              onChange={handleWallpaperUpload}
              className="hidden"
              aria-label="Upload custom wallpaper"
            />
            <button
              onClick={() => wallpaperInputRef.current?.click()}
              disabled={uploadingWallpaper}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-2 py-1 text-[10px] font-bold text-neutral-400 transition hover:bg-neutral-800/60 disabled:opacity-50"
              title="Upload custom wallpaper"
            >
              <Upload size={12} />
              {uploadingWallpaper ? "…" : "Custom"}
            </button>
            <span className="flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[10px] font-bold text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              {connected ? "Online" : "Standby"}
            </span>
            <button
              onClick={() => setRightOpen((o) => !o)}
              className="rounded-lg border border-neutral-700/50 p-2 text-neutral-400 hover:bg-neutral-800/50"
              aria-label="Toggle context panel"
            >
              {rightOpen ? (
                <ChevronRight size={18} />
              ) : (
                <ChevronLeft size={18} />
              )}
            </button>
          </div>
        </header>

        {/* Mobile connector strip */}
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-800/40 px-3 py-1.5 backdrop-blur-md sm:hidden">
          <ConnectorStrip connected={connected} />
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Center: mission canvas + chat composer */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-neutral-800/40">
            <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
              {activeTab === "mission" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="shrink-0">
                    <MissionCanvas onPromptAction={handleStarterPrompt} />
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <ChatTerminal
                      agentId="director"
                      onLogAction={addLog}
                      onCommandAction={addLog}
                      onConnectionChangeAction={setConnected}
                      onDeployAction={handleDeploy}
                      trigger={chatTrigger}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-neutral-400">
                  {activeTab} tab coming soon
                </div>
              )}
            </div>
          </section>

          {/* Right: context / output panel */}
          {rightOpen && (
            <aside className="hidden w-[360px] min-w-0 flex-col overflow-hidden border-l border-neutral-800/40 bg-[#060606]/80 backdrop-blur-md lg:flex">
              <div className="flex border-b border-neutral-800/40">
                <button
                  onClick={() => setRightTab("output")}
                  className={`flex-1 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                    rightTab === "output"
                      ? "bg-cyan-500/10 text-cyan-300"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Output
                </button>
                <button
                  onClick={() => setRightTab("context")}
                  className={`flex-1 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                    rightTab === "context"
                      ? "bg-cyan-500/10 text-cyan-300"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Context
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                {rightTab === "output" ? (
                  <OutputPanel
                    logs={logs}
                    selectedFile={selectedFile}
                    files={filePaths}
                    artifact={activeArtifact}
                    onSelectFileAction={setSelectedFile}
                  />
                ) : (
                  <div className="flex h-full flex-col gap-3 overflow-y-auto text-xs text-neutral-400">
                    <div className="rounded-xl border border-neutral-800/60 p-3">
                      <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-cyan-300">
                        Active Mission
                      </div>
                      <p>
                        Build a real GitHub-backed workspace for
                        LiTTree-LabStudios.
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-800/60 p-3">
                      <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-cyan-300">
                        Connected Repos
                      </div>
                      <p>
                        {project
                          ? `${project.owner}/${project.repository} (${project.working_branch})`
                          : "No GitHub repo connected yet."}
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-800/60 p-3">
                      <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-cyan-300">
                        Agent
                      </div>
                      <p>LiTT Director</p>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </main>
  );
}
