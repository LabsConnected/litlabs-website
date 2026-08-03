"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { useStudioAgentStore } from "../stores/useStudioAgentStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useCanonicalConversation } from "../hooks/useCanonicalConversation";
import type { ArtifactAction } from "@/lib/canvas/types";

import CommandStudioHeader from "./CommandStudioHeader";
import CommandStudioNav, { MobileCommandNav } from "./CommandStudioNav";
import CommandComposer, { type ComposerContextLine } from "./CommandComposer";
import LiTEmptyState from "./LiTEmptyState";
import StudioTranscript from "./StudioTranscript";
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
// ChatTool is NOT mounted here — the conversation controller
// (useStudioConversation) + StudioTranscript + CommandComposer replace it.
const CanvasPanel = dynamic(() => import("./canvas/CanvasPanel").then((m) => m.CanvasPanel), { ssr: false });
const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });
const AudioTool = dynamic(() => import("../tools/AudioTool"), { ssr: false });
const MusicTool = dynamic(() => import("../tools/MusicTool"), { ssr: false });
const BuilderTool = dynamic(() => import("../tools/BuilderTool"), { ssr: false });
const CanvasTool = dynamic(() => import("../tools/CanvasTool"), { ssr: false });
const AgentTool = dynamic(() => import("../tools/AgentTool"), { ssr: false });
const GalleryTool = dynamic(() => import("../tools/GalleryTool"), { ssr: false });
const StudioTerminalDrawer = dynamic(() => import("./StudioTerminalDrawer"), { ssr: false });
const MissionForge = dynamic(() => import("../tools/MissionForge"), { ssr: false });
const CLIBridgeTool = dynamic(() => import("../tools/CLIBridgeTool"), { ssr: false });
const ColorByNumberTool = dynamic(() => import("../tools/ColorByNumberTool"), { ssr: false });
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });
const PluginsTool = dynamic(() => import("../tools/PluginsTool"), { ssr: false });
const CameraTool = dynamic(() => import("../tools/CameraTool"), { ssr: false });
const ScreenTool = dynamic(() => import("../tools/ScreenTool"), { ssr: false });

type DockPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "full";

/**
 * Which surface renders inside Studio/Work. The conversation is the
 * default; the Builder adapter renders when the user explicitly routes
 * to `build`. This is dynamic state — not derived from the initial URL
 * — so switching to Work after visiting Build shows the conversation
 * unless Build is requested again.
 */
type WorkSurface = "conversation" | "builder";

// Map legacy tool ids to their components. "chat" is NOT here — the
// conversation is handled by useStudioConversation + StudioTranscript.
const TOOL_COMPONENTS: Partial<Record<StudioTool, React.ComponentType>> = {
  canvas: CanvasTool,
  image: ImageTool,
  video: VideoTool,
  audio: AudioTool,
  music: MusicTool,
  build: BuilderTool,
  code: CanvasTool,
  agents: AgentTool,
  assets: GalleryTool,
  plugins: PluginsTool,
  camera: CameraTool,
  screen: ScreenTool,
  workflows: MissionForge,
  space: SpaceTool,
  clibridge: CLIBridgeTool,
  color: ColorByNumberTool,
};

function AgentVoiceSync() {
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setVoiceAgent = useVoiceStore((s) => s.setActiveAgent);
  useEffect(() => {
    // Legacy agent names (nova/forge/echo) map to LiTT for voice purposes.
    const voiceAgent = ["litt", "spark", "researcher", "writer", "marketer", "coder", "analyst"].includes(activeAgentId)
      ? (activeAgentId as import("@/features/voice/types").VoiceAgentId)
      : "litt";
    setVoiceAgent(voiceAgent);
  }, [activeAgentId, setVoiceAgent]);
  return null;
}

/**
 * CommandStudio — Phase 1.1 functional stabilization.
 *
 * One compact header, five navigation destinations, one dominant LiTT
 * workspace, one persistent composer, one optional inspector, one
 * optional Activity/Terminal drawer. The conversation controller
 * (useStudioConversation) is the single source of truth — no invisible
 * ChatTool, no duplicate composer, no custom-event bridge.
 */
export default function CommandStudio() {
  const { theme } = useTheme();
  const { userId, getToken } = useClerkAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { capabilities, refresh: refreshCapabilities } = useConnectionSummary();
  const projectReady = Boolean(capabilities.projectId);

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
  const [, setPendingCommand] = useState<string>(initial.command ?? "");
  const [composerValue, setComposerValue] = useState("");
  // Dynamic Work surface — not derived from initial.legacyTool after init.
  const [workSurface, setWorkSurface] = useState<WorkSurface>(
    initial.legacyTool === "build" ? "builder" : "conversation",
  );

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(!!initial.openInspector);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(initial.openInspector ?? "plan");
  const [inspectorWidth, setInspectorWidth] = useState(320); // pixels
  const [drawerOpen, setDrawerOpen] = useState<boolean>(!!initial.openDrawer);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(initial.openDrawer ?? "activity");
  const [drawerHeight, setDrawerHeight] = useState(240); // pixels

  const [cameraDock, setCameraDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "top-right" });
  const [screenDock, setScreenDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "bottom-left" });
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [pendingCanvasAction, setPendingCanvasAction] = useState<ArtifactAction | null>(null);

  const handleSelectDestination = useCallback((dest: StudioDestination) => {
    setDestination(dest);
  }, []);

  // handleRouteTool must be declared before useStudioConversation so the
  // conversation controller can reference it without a TDZ error.
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
    if (mapped.destination === "studio") {
      setStudioMode((mapped.mode as StudioMode) ?? "work");
      // Explicit Build route → builder surface; anything else → conversation.
      setWorkSurface(tool === "build" ? "builder" : "conversation");
    }
    if (mapped.destination === "create") setCreateMode((mapped.mode as CreateMode) ?? "image");
    if (mapped.destination === "more") setMoreMode((mapped.mode as MoreMode) ?? "plugins");
    if (mapped.openDrawer) {
      setDrawerOpen(true);
      setDrawerTab(mapped.openDrawer);
    }
    if (mapped.openInspector) {
      setInspectorOpen(true);
      setInspectorTab(mapped.openInspector);
    }
    setPendingCommand(command);
  }, []);

  // The single conversation controller — calls canonical V12 API.
  const conversation = useCanonicalConversation({
    onRouteTool: handleRouteTool,
    serverProjectId: capabilities.projectId,
  });

  // Sync destination -> URL ?tool= (preserves legacy bookmarks).
  // Use a destination-specific mode so Video writes ?tool=video, not ?tool=image.
  useEffect(() => {
    const activeMode =
      destination === "studio" ? studioMode :
      destination === "create" ? createMode :
      destination === "more" ? moreMode :
      undefined;
    const legacyTool = destinationToLegacyTool(destination, activeMode);
    try {
      localStorage.setItem("littree:studio:tool", legacyTool);
    } catch {
      // ignore
    }
    // Compare target tool with current URL tool — skip if already correct
    const currentTool = searchParams.get("tool");
    if (currentTool === legacyTool) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tool", legacyTool);
    const target = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (target !== current) {
      router.replace(target, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, studioMode, createMode, moreMode, pathname, router]);

  // Handle legacy "studio:switch-tool" events emitted from inside tools.
  useEffect(() => {
    const handler = (e: Event) => {
      const tool = (e as CustomEvent<string>).detail as StudioTool;
      if (!tool) return;
      handleRouteTool(tool);
    };
    window.addEventListener("studio:switch-tool", handler);
    return () => window.removeEventListener("studio:switch-tool", handler);
  }, [handleRouteTool]);

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

  const [creatingProject, setCreatingProject] = useState(false);

  const handleComposerSend = useCallback(async (value: string, attachments?: string[]) => {
    // The canonical controller provisions a starter project and conversation
    // when needed. Do not block first-time users at the composer boundary.
    try {
      const result = await conversation.send(value, attachments);
      if (result?.accepted && !capabilities.projectId) {
        await refreshCapabilities();
      }
      return result;
    } catch {
      // Restore the typed message so the user doesn't lose input
      setComposerValue(value);
    }
  }, [conversation, capabilities.projectId, refreshCapabilities]);

  const handleEmptyAction = useCallback((prompt: string) => {
    setComposerValue(prompt);
  }, []);

  const handleStartBlank = useCallback(async () => {
    setCreatingProject(true);
    try {
      const token = await getToken?.();
      const res = await fetch("/api/studio-projects", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sourceType: "blank",
          name: "Untitled Project",
          templateId: "blank-static",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[handleStartBlank] Failed to create project:", err);
        return;
      }
      const { project } = await res.json();
      // Persist the new project ID to localStorage immediately so that
      // the conversation controller can find it via getActiveProjectId's
      // localStorage fallback. The key is scoped by user.
      if (typeof window !== "undefined") {
        try {
          const key = userId ? `litt:active-project-id:${userId}` : "litt:active-project-id";
          localStorage.setItem(key, project.id);
        } catch {
          // ignore
        }
      }
      // Update URL with project ID
      const params = new URLSearchParams(searchParams.toString());
      params.set("project", project.id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      // Refresh capabilities so projectId propagates
      await refreshCapabilities();
      setDestination("studio");
      setStudioMode("work");
      setWorkSurface("conversation");
    } catch (err) {
      console.error("[handleStartBlank] Error:", err);
    } finally {
      setCreatingProject(false);
    }
  }, [searchParams, pathname, router, refreshCapabilities, userId, getToken]);

  const handleConnectRepo = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/api/github/install";
    }
  }, []);

  // Header actions — truthful.
  const handlePreview = useCallback(() => {
    setDestination("studio");
    setStudioMode("preview");
  }, []);
  const handleOpenActivity = useCallback(() => {
    setDrawerOpen(true);
    setDrawerTab("activity");
  }, []);

  // Context line for the composer.
  const contextLine: ComposerContextLine = useMemo(() => ({
    repo: capabilities.repositoryName ?? undefined,
    branch: typeof window !== "undefined" ? (searchParams.get("branch") ?? undefined) : undefined,
    permissionMode: capabilities.writeAccess ? "Writes allowed" : "Writes require approval",
  }), [capabilities.repositoryName, capabilities.writeAccess, searchParams]);

  // Resolve the legacy tool to render for the active destination/mode.
  // Studio/Work renders the conversation (transcript + composer) unless
  // the legacy tool is "build" (Builder adapter) — not ChatTool.
  const activeLegacyTool: StudioTool | null = useMemo(() => {
    if (destination === "studio") {
      if (studioMode === "code") return "code";
      if (studioMode === "files") return "canvas";
      if (studioMode === "preview") return "build";
      // Work mode: dynamic surface state, not initial URL
      return workSurface === "builder" ? "build" : null;
    }
    if (destination === "create") {
      if (createMode === "video") return "video";
      if (createMode === "audio") return "audio";
      if (createMode === "music") return "music";
      if (createMode === "brand") return "color";
      return "image";
    }
    if (destination === "assets") return "assets";
    if (destination === "agents") return "agents";
    if (destination === "more") return moreMode as StudioTool;
    return null;
  }, [destination, studioMode, createMode, moreMode, workSurface]);

  const WorkspaceComponent = activeLegacyTool ? TOOL_COMPONENTS[activeLegacyTool] : null;
  const isStudioWorkConversation = destination === "studio" && studioMode === "work" && activeLegacyTool === null;
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
          onPreview={handlePreview}
          onOpenActivity={handleOpenActivity}
          projectReady={projectReady}
          capabilities={capabilities}
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
                        if (destination === "studio") {
                          setStudioMode(t.id as StudioMode);
                          // Clicking the visible Work tab always returns
                          // to the conversation surface. Build must be
                          // explicitly routed again to show the Builder.
                          if (t.id === "work") setWorkSurface("conversation");
                        } else {
                          setCreateMode(t.id as CreateMode);
                        }
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
                {isStudioWorkConversation ? (
                  <StudioWorkSurface
                    messages={conversation.messages}
                    busy={conversation.busy}
                    activeAgentId={conversation.activeAgentId}
                    fallbackNotice={conversation.fallbackNotice}
                    onRouteTool={handleRouteTool}
                    onRegenerate={conversation.regenerate}
                    onEmptyAction={handleEmptyAction}
                    hasProject={projectReady}
                    projectName={capabilities.projectName}
                    sourceType={capabilities.sourceType}
                    githubInstalled={capabilities.githubInstalled}
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

              {/* Right inspector — collapsed by default, width resizable */}
              <StudioInspector
                open={inspectorOpen}
                onToggle={() => setInspectorOpen((v) => !v)}
                activeTab={inspectorTab}
                onTabChange={setInspectorTab}
                width={inspectorWidth}
                onWidthChange={setInspectorWidth}
              />
            </div>

            {/* Bottom drawer — collapsed by default, sits above composer, height resizable */}
            <StudioDrawer
              open={drawerOpen}
              onToggle={() => setDrawerOpen((v) => !v)}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              height={drawerHeight}
              onHeightChange={setDrawerHeight}
            >
              {drawerTab === "terminal" ? <StudioTerminalDrawer projectId={capabilities.projectId} /> : null}
            </StudioDrawer>

            {/* Persistent composer — visible at all times in Studio/Work conversation */}
            {/* Reauthentication banner — visible when session expires during Studio use.
                Disables the composer and offers a real recovery action. */}
            {isStudioWorkConversation && (conversation.requiresReauth || conversation.sendError) && (
              <div
                className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2.5 text-[12px]"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  backgroundColor: "rgba(239,68,68,0.08)",
                  color: "#fca5a5",
                }}
              >
                <span className="min-w-0 flex-1 font-medium">
                  {conversation.requiresReauth
                    ? "Your session expired. Sign in again to continue."
                    : conversation.sendError}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {!conversation.requiresReauth && conversation.sendError && (
                    <button
                      type="button"
                      onClick={() => conversation.clearSendError()}
                      className="whitespace-nowrap rounded px-2 py-1 text-[10px] font-bold hover:bg-white/10"
                      aria-label="Dismiss error"
                    >
                      ✕
                    </button>
                  )}
                  {conversation.requiresReauth ? (
                    <button
                      type="button"
                      onClick={() => {
                        conversation.clearRequiresReauth();
                        window.location.href = "/sign-in?redirect_url=" + encodeURIComponent(window.location.pathname + window.location.search);
                      }}
                      className="whitespace-nowrap rounded border border-red-400/30 px-2 py-1 text-[10px] font-bold hover:bg-red-500/10"
                    >
                      Sign in again
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="whitespace-nowrap rounded border border-red-400/30 px-2 py-1 text-[10px] font-bold hover:bg-red-500/10"
                    >
                      Refresh session
                    </button>
                  )}
                </div>
              </div>
            )}

            {isStudioWorkConversation && (
              <CommandComposer
                value={composerValue}
                onChange={setComposerValue}
                onSend={handleComposerSend}
                onAgentChange={conversation.switchAgent}
                busy={conversation.busy || creatingProject}
                disabled={conversation.requiresReauth}
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

      {/* Persistent media overlays (camera/screen docks) */}
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

/* ── Studio/Work surface: empty state OR real transcript ──────── */
function StudioWorkSurface({
  messages,
  busy,
  activeAgentId,
  fallbackNotice,
  onRouteTool,
  onRegenerate,
  onEmptyAction,
  hasProject,
  projectName,
  sourceType,
  githubInstalled,
  onStartBlank,
  onConnectRepo,
}: {
  messages: import("../stores/useStudioAgentStore").ChatMessage[];
  busy: boolean;
  activeAgentId: import("../stores/useStudioAgentStore").AgentId;
  fallbackNotice: string | null;
  onRouteTool: (tool: StudioTool, command?: string) => void;
  onRegenerate: () => void;
  onEmptyAction: (prompt: string) => void;
  hasProject: boolean;
  projectName: string | null;
  sourceType: "github" | "blank" | "template" | null;
  githubInstalled: boolean;
  onStartBlank: () => void;
  onConnectRepo: () => void;
}) {
  const isEmpty = messages.length === 0;
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {fallbackNotice && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[10px] font-bold"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "rgba(227,179,65,0.08)",
            color: "#e3b341",
          }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          {fallbackNotice}
        </div>
      )}
      {isEmpty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LiTEmptyState
            activeAgentId={activeAgentId}
            hasProject={hasProject}
            projectName={projectName}
            sourceType={sourceType}
            githubInstalled={githubInstalled}
            onPick={onEmptyAction}
            onStartBlank={onStartBlank}
            onConnectRepo={onConnectRepo}
          />
        </div>
      ) : (
        <StudioTranscript
          messages={messages}
          busy={busy}
          activeAgentId={activeAgentId}
          onRouteTool={onRouteTool}
          onRegenerate={onRegenerate}
        />
      )}
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
