"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { VoiceDiagnosticsDrawer } from "./VoiceDiagnosticsDrawer";
import { useStudioAgentStore } from "../stores/useStudioAgentStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import type { ArtifactAction } from "@/lib/canvas/types";

import CommandStudioHeader from "./CommandStudioHeader";
import CommandStudioNav, { MobileCommandNav } from "./CommandStudioNav";
import CommandComposer, { type ComposerContextLine } from "./CommandComposer";
import LiTEmptyState from "./LiTEmptyState";
import { StudioInspector, StudioDrawer } from "./StudioWorkspaceFrame";
import {
  mapLegacyToolToDestination,
  destinationToLegacyTool,
  type StudioDestination,
  type StudioMode,
  type CreateMode,
  type MoreMode,
  type InspectorTab,
  type DrawerTab,
} from "../lib/studio-destinations";
import type { StudioTool } from "./StudioSidebar";

/* ── Legacy tool components (loaded through adapters) ──────────── */
const ChatTool = dynamic(() => import("../tools/ChatTool"), { ssr: false });
const CanvasPanel = dynamic(() => import("./canvas/CanvasPanel").then((m) => m.CanvasPanel), { ssr: false });
const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });
const AudioTool = dynamic(() => import("../tools/AudioTool"), { ssr: false });
const BuilderTool = dynamic(() => import("../tools/BuilderTool"), { ssr: false });
const CanvasTool = dynamic(() => import("../tools/CanvasTool"), { ssr: false });
const AgentTool = dynamic(() => import("../tools/AgentTool"), { ssr: false });
const GalleryTool = dynamic(() => import("../tools/GalleryTool"), { ssr: false });
const TerminalTool = dynamic(() => import("../tools/AgentsTerminalTool"), { ssr: false });
const MissionForge = dynamic(() => import("../tools/MissionForge"), { ssr: false });
const CLIBridgeTool = dynamic(() => import("../tools/CLIBridgeTool"), { ssr: false });
const ColorByNumberTool = dynamic(() => import("../tools/ColorByNumberTool"), { ssr: false });
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });
const PluginsTool = dynamic(() => import("../tools/PluginsTool"), { ssr: false });
const CameraTool = dynamic(() => import("../tools/CameraTool"), { ssr: false });
const ScreenTool = dynamic(() => import("../tools/ScreenTool"), { ssr: false });

type DockPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "full";

const TOOL_COMPONENTS: Partial<Record<StudioTool, React.ComponentType>> = {
  chat: ChatTool,
  canvas: CanvasTool,
  image: ImageTool,
  video: VideoTool,
  audio: AudioTool,
  build: BuilderTool,
  code: CanvasTool,
  agents: AgentTool,
  assets: GalleryTool,
  plugins: PluginsTool,
  camera: CameraTool,
  screen: ScreenTool,
  terminal: TerminalTool,
  workflows: MissionForge,
  space: SpaceTool,
  clibridge: CLIBridgeTool,
  color: ColorByNumberTool,
};

function AgentVoiceSync() {
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setVoiceAgent = useVoiceStore((s) => s.setActiveAgent);
  useEffect(() => {
    setVoiceAgent(activeAgentId);
  }, [activeAgentId, setVoiceAgent]);
  return null;
}

/**
 * CommandStudio — Phase 1 visual rescue shell.
 *
 * One compact header, five navigation destinations, one dominant LiTT
 * workspace, one persistent composer, one optional inspector, one
 * optional Activity/Terminal drawer. Existing tool components are
 * preserved and routed through adapters — no runtime rewrite.
 */
export default function CommandStudio({ isDemo: _isDemo = false }: { isDemo?: boolean } = {}) {
  const { theme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { capabilities, loading: connectionsLoading } = useConnectionSummary();
  const projectReady =
    capabilities.repository === "connected" ||
    capabilities.terminalExecution === "available";

  // Resolve initial destination from legacy ?tool= query.
  const initial = useMemo(() => {
    const fromUrl = searchParams.get("tool");
    if (fromUrl === "pipeline") {
      return mapLegacyToolToDestination("workflows");
    }
    return mapLegacyToolToDestination(fromUrl, searchParams.get("mission") ?? undefined);
  }, [searchParams]);

  const [destination, setDestination] = useState<StudioDestination>(initial.destination);
  const [studioMode, setStudioMode] = useState<StudioMode>((initial.mode as StudioMode) ?? "work");
  const [createMode, setCreateMode] = useState<CreateMode>((initial.mode as CreateMode) ?? "image");
  const [moreMode, setMoreMode] = useState<MoreMode>((initial.mode as MoreMode) ?? "plugins");
  const [pendingCommand, setPendingCommand] = useState<string>(initial.command ?? "");
  const [composerValue, setComposerValue] = useState("");

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("plan");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("activity");

  const [cameraDock, setCameraDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "top-right" });
  const [screenDock, setScreenDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "bottom-left" });
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [pendingCanvasAction, setPendingCanvasAction] = useState<ArtifactAction | null>(null);

  const isInitialMount = useRef(true);

  // Sync destination -> URL ?tool= (preserves legacy bookmarks).
  useEffect(() => {
    const legacyTool = destinationToLegacyTool(destination, studioMode ?? createMode ?? moreMode);
    try {
      localStorage.setItem("littree:studio:tool", legacyTool);
    } catch {
      // ignore
    }
    if (isInitialMount.current) {
      isInitialMount.current = false;
      const params = new URLSearchParams(searchParams.toString());
      params.set("tool", legacyTool);
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("tool", legacyTool);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  }, [destination, studioMode, createMode, moreMode, pathname, router, searchParams]);

  // Handle legacy "studio:switch-tool" events emitted from inside tools.
  useEffect(() => {
    const handler = (e: Event) => {
      const tool = (e as CustomEvent<string>).detail as StudioTool;
      if (!tool) return;
      const mapped = mapLegacyToolToDestination(tool);
      setDestination(mapped.destination);
      if (mapped.destination === "studio") setStudioMode((mapped.mode as StudioMode) ?? "work");
      if (mapped.destination === "create") setCreateMode((mapped.mode as CreateMode) ?? "image");
      if (mapped.destination === "more") setMoreMode((mapped.mode as MoreMode) ?? "plugins");
    };
    window.addEventListener("studio:switch-tool", handler);
    return () => window.removeEventListener("studio:switch-tool", handler);
  }, []);

  // Handle canvas action execution from chat.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ArtifactAction>).detail;
      if (detail) {
        setPendingCanvasAction(detail);
        setCanvasOpen(true);
      }
    };
    window.addEventListener("canvas:execute-action", handler);
    return () => window.removeEventListener("canvas:execute-action", handler);
  }, []);

  const handleSelectDestination = useCallback((dest: StudioDestination) => {
    setDestination(dest);
  }, []);

  const handleRouteTool = useCallback((tool: StudioTool, command = "") => {
    if (tool === "camera") {
      setCameraDock((v) => ({ ...v, open: true }));
      return;
    }
    if (tool === "screen") {
      setScreenDock((v) => ({ ...v, open: true }));
      return;
    }
    const mapped = mapLegacyToolToDestination(tool, command);
    setDestination(mapped.destination);
    if (mapped.destination === "studio") setStudioMode((mapped.mode as StudioMode) ?? "work");
    if (mapped.destination === "create") setCreateMode((mapped.mode as CreateMode) ?? "image");
    if (mapped.destination === "more") setMoreMode((mapped.mode as MoreMode) ?? "plugins");
    setPendingCommand(command);
  }, []);

  const handleComposerSend = useCallback(async (value: string, attachments?: string[]) => {
    // Route through the legacy ChatTool by ensuring we're in Studio/Work.
    if (destination !== "studio") {
      setDestination("studio");
      setStudioMode("work");
    }
    // The ChatTool component below owns the actual /api/gemini/chat call.
    // We expose a custom event so ChatTool picks up the outgoing message.
    window.dispatchEvent(new CustomEvent("command-studio:send", { detail: { value, attachments } }));
    return "";
  }, [destination]);

  const handleEmptyAction = useCallback((prompt: string) => {
    setComposerValue(prompt);
    // Focus is handled by the composer's auto-focus on value change.
  }, []);

  const handleStartBlank = useCallback(() => {
    setDestination("studio");
    setStudioMode("work");
  }, []);

  const handleConnectRepo = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/api/github/install";
    }
  }, []);

  // Context line for the composer.
  const contextLine: ComposerContextLine = useMemo(() => ({
    repo: capabilities.repositoryName ?? undefined,
    branch: typeof window !== "undefined" ? (searchParams.get("branch") ?? undefined) : undefined,
    permissionMode: capabilities.writeAccess ? "Writes allowed" : "Writes require approval",
  }), [capabilities.repositoryName, capabilities.writeAccess, searchParams]);

  // Resolve the legacy tool to render for the active destination/mode.
  const activeLegacyTool: StudioTool | null = useMemo(() => {
    if (destination === "studio") {
      if (studioMode === "code") return "code";
      if (studioMode === "files") return "canvas";
      if (studioMode === "preview") return "build";
      return "chat";
    }
    if (destination === "create") {
      if (createMode === "video") return "video";
      if (createMode === "audio" || createMode === "music") return "audio";
      if (createMode === "brand") return "color";
      return "image";
    }
    if (destination === "assets") return "assets";
    if (destination === "agents") return "agents";
    if (destination === "more") {
      return moreMode as StudioTool;
    }
    return null;
  }, [destination, studioMode, createMode, moreMode]);

  const WorkspaceComponent = activeLegacyTool ? TOOL_COMPONENTS[activeLegacyTool] : null;
  const isStudioWork = destination === "studio" && studioMode === "work";
  const isCanvas = destination === "studio" && studioMode === "files";

  // Studio internal tabs (Work | Preview | Code | Files)
  const studioTabs: { id: StudioMode; label: string }[] = [
    { id: "work", label: "Work" },
    { id: "preview", label: "Preview" },
    { id: "code", label: "Code" },
    { id: "files", label: "Files" },
  ];

  // Create internal tabs (Image | Video | Audio | Music | Brand)
  const createTabs: { id: CreateMode; label: string }[] = [
    { id: "image", label: "Image" },
    { id: "video", label: "Video" },
    { id: "audio", label: "Audio" },
    { id: "music", label: "Music" },
    { id: "brand", label: "Brand" },
  ];

  return (
    <VoiceSessionProvider>
      <AgentVoiceSync />
      <VoiceDiagnosticsDrawer />

      <div
        className="studio-shell flex h-dvh w-full flex-col overflow-hidden"
        data-layout={theme.layoutStyle}
        style={{
          backgroundColor: "var(--studio-bg)",
          color: "var(--text-primary)",
        }}
      >
        {/* One compact header — replaces AutonomicLoopBanner + StudioTopBar */}
        <CommandStudioHeader
          branch={contextLine.branch}
          onOpenActivity={() => { setDrawerOpen(true); setDrawerTab("activity"); }}
          onDeploy={() => { setDrawerOpen(true); setDrawerTab("activity"); }}
          projectReady={projectReady}
        />

        {/* Body: nav rail + workspace + inspector */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <CommandStudioNav active={destination} onSelect={handleSelectDestination} />

          <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden overflow-x-hidden">
            {/* Internal tab strip for Studio + Create destinations */}
            {(destination === "studio" || destination === "create") && (
              <div
                className="flex shrink-0 items-center gap-0.5 border-b px-2"
                style={{
                  height: 36,
                  backgroundColor: "var(--studio-surface)",
                  borderColor: "var(--studio-border)",
                }}
              >
                {(destination === "studio" ? studioTabs : createTabs).map((t) => {
                  const isActive = destination === "studio" ? studioMode === t.id : createMode === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        if (destination === "studio") setStudioMode(t.id as StudioMode);
                        else setCreateMode(t.id as CreateMode);
                      }}
                      className="rounded-md px-3 py-1.5 text-[11px] font-bold transition"
                      style={{
                        color: isActive ? "var(--litt-primary)" : "var(--text-muted)",
                        backgroundColor: isActive ? "rgba(114,242,56,0.08)" : "transparent",
                      }}
                      aria-label={t.label}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Workspace content */}
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {isStudioWork ? (
                  <StudioWorkSurface
                    projectReady={projectReady}
                    connectionsLoading={connectionsLoading}
                    onRouteTool={handleRouteTool}
                    onToggleCamera={() => setCameraDock((v) => ({ ...v, open: !v.open }))}
                    cameraActive={cameraDock.open}
                    pendingCommand={pendingCommand}
                    onEmptyAction={handleEmptyAction}
                    onStartBlank={handleStartBlank}
                    onConnectRepo={handleConnectRepo}
                  />
                ) : isCanvas ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <CanvasPanel pendingAction={pendingCanvasAction} onActionExecuted={() => setPendingCanvasAction(null)} />
                  </div>
                ) : WorkspaceComponent ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <WorkspaceComponent />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-[12px]" style={{ color: "var(--text-muted)" }}>
                    Nothing here yet
                  </div>
                )}
              </div>

              {/* Right inspector — collapsed by default */}
              <StudioInspector
                open={inspectorOpen}
                onToggle={() => setInspectorOpen((v) => !v)}
                activeTab={inspectorTab}
                onTabChange={setInspectorTab}
              />
            </div>

            {/* Bottom drawer — collapsed by default, sits above composer */}
            <StudioDrawer
              open={drawerOpen}
              onToggle={() => setDrawerOpen((v) => !v)}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
            />

            {/* Persistent composer — visible at all times in Studio/Work */}
            {isStudioWork && (
              <CommandComposer
                value={composerValue}
                onChange={setComposerValue}
                onSend={handleComposerSend}
                onToggleCamera={() => setCameraDock((v) => ({ ...v, open: !v.open }))}
                cameraActive={cameraDock.open}
                contextLine={contextLine}
              />
            )}
          </main>
        </div>

        {/* Mobile bottom nav — 5 destinations */}
        <MobileCommandNav active={destination} onSelect={handleSelectDestination} />
      </div>

      {/* Canvas overlay — opens when a canvas action is executed from chat */}
      {canvasOpen && (
        <aside
          className="fixed z-[10009] flex flex-col overflow-hidden border shadow-2xl md:bottom-0 md:right-0 md:top-[calc(var(--studio-header-h)+4px)] md:w-full md:max-w-[520px] md:border-l bottom-[calc(56px+env(safe-area-inset-bottom))] left-0 right-0 top-auto h-[55dvh] rounded-t-2xl border-t"
          style={{
            backgroundColor: "rgba(8,9,13,0.97)",
            borderColor: "var(--studio-border-strong)",
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden" />
          <div
            className="flex h-9 shrink-0 items-center justify-between px-3 border-b"
            style={{ borderColor: "var(--studio-border)" }}
          >
            <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
              Canvas
            </span>
            <button
              onClick={() => setCanvasOpen(false)}
              className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/8"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close Canvas panel"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <CanvasPanel pendingAction={pendingCanvasAction} onActionExecuted={() => setPendingCanvasAction(null)} />
          </div>
        </aside>
      )}

      {/* Persistent media overlays (camera/screen docks) — reused from StudioOS */}
      <MediaOverlayHost
        cameraDock={cameraDock}
        screenDock={screenDock}
        onCameraClose={() => setCameraDock((v) => ({ ...v, open: false }))}
        onScreenClose={() => setScreenDock((v) => ({ ...v, open: false }))}
        onCameraPosChange={(pos) => setCameraDock((v) => ({ ...v, pos }))}
        onScreenPosChange={(pos) => setScreenDock((v) => ({ ...v, pos }))}
      />
    </VoiceSessionProvider>
  );
}

/* ── Studio/Work surface: empty state OR chat transcript + composer ─ */
function StudioWorkSurface({
  projectReady,
  connectionsLoading,
  onRouteTool,
  onToggleCamera,
  cameraActive,
  pendingCommand,
  onEmptyAction,
  onStartBlank,
  onConnectRepo,
}: {
  projectReady: boolean;
  connectionsLoading: boolean;
  onRouteTool: (tool: StudioTool, command?: string) => void;
  onToggleCamera: () => void;
  cameraActive: boolean;
  pendingCommand: string;
  onEmptyAction: (prompt: string) => void;
  onStartBlank: () => void;
  onConnectRepo: () => void;
}) {
  // The ChatTool owns the conversation state + /api/gemini/chat calls.
  // We mount it but visually overlay the empty state when there are no
  // messages. The composer is rendered by the parent (CommandStudio) so
  // it stays persistent across destination switches.
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Empty state overlay — shown when chat is empty */}
      {!connectionsLoading && (
        <div className="absolute inset-0 z-10 overflow-y-auto">
          <LiTEmptyState
            hasProject={projectReady}
            onPick={onEmptyAction}
            onStartBlank={onStartBlank}
            onConnectRepo={onConnectRepo}
          />
        </div>
      )}
      {/* ChatTool mounted underneath so it keeps its session state */}
      <div className="relative z-0 h-full min-h-0 opacity-0">
        <ChatTool
          onRouteTool={onRouteTool}
          onToggleCamera={onToggleCamera}
          cameraActive={cameraActive}
          requestedTool="chat"
          pendingCommand={pendingCommand}
        />
      </div>
    </div>
  );
}

/* ── Media overlay host (camera/screen docks) ──────────────────── */
function MediaOverlayHost({
  cameraDock,
  screenDock,
  onCameraClose,
  onScreenClose,
  onCameraPosChange,
  onScreenPosChange,
}: {
  cameraDock: { open: boolean; pos: DockPosition };
  screenDock: { open: boolean; pos: DockPosition };
  onCameraClose: () => void;
  onScreenClose: () => void;
  onCameraPosChange: (pos: DockPosition) => void;
  onScreenPosChange: (pos: DockPosition) => void;
}) {
  // Defer to the existing CameraTool/ScreenTool components via dynamic
  // import when open. Phase 1 keeps the dock chrome minimal.
  if (!cameraDock.open && !screenDock.open) return null;
  return (
    <>
      {cameraDock.open && (
        <CameraDock pos={cameraDock.pos} onClose={onCameraClose} onMove={() => onCameraPosChange(nextPos(cameraDock.pos))} />
      )}
      {screenDock.open && (
        <ScreenDock pos={screenDock.pos} onClose={onScreenClose} onMove={() => onScreenPosChange(nextPos(screenDock.pos))} />
      )}
    </>
  );
}

function nextPos(pos: DockPosition): DockPosition {
  const order: DockPosition[] = ["top-right", "bottom-right", "bottom-left", "top-left"];
  return order[(order.indexOf(pos) + 1) % order.length];
}

function DockFrame({
  pos,
  label,
  onClose,
  onMove,
  children,
}: {
  pos: DockPosition;
  label: string;
  onClose: () => void;
  onMove: () => void;
  children?: React.ReactNode;
}) {
  const posClass =
    pos === "top-right" ? "top-2 right-2" :
    pos === "bottom-right" ? "bottom-2 right-2" :
    pos === "bottom-left" ? "bottom-2 left-2" :
    "top-2 left-2";
  return (
    <div
      className={`fixed z-[10010] flex w-64 flex-col overflow-hidden rounded-xl border shadow-2xl ${posClass}`}
      style={{
        height: 180,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5" style={{ borderColor: "var(--studio-border)" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden />
        <span className="flex-1 text-[9px] font-black uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{label}</span>
        <button type="button" onClick={onMove} className="grid h-6 w-6 place-items-center rounded hover:bg-white/10" style={{ color: "var(--text-muted)" }} aria-label="Move dock">⇮</button>
        <button type="button" onClick={onClose} className="grid h-6 w-6 place-items-center rounded hover:bg-white/10" style={{ color: "var(--text-muted)" }} aria-label="Close dock">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function CameraDock({ pos, onClose, onMove }: { pos: DockPosition; onClose: () => void; onMove: () => void }) {
  return (
    <DockFrame pos={pos} label="Camera" onClose={onClose} onMove={onMove}>
      <CameraTool />
    </DockFrame>
  );
}

function ScreenDock({ pos, onClose, onMove }: { pos: DockPosition; onClose: () => void; onMove: () => void }) {
  return (
    <DockFrame pos={pos} label="Screen" onClose={onClose} onMove={onMove}>
      <ScreenTool />
    </DockFrame>
  );
}
