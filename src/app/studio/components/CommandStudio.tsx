"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import {
  Image as ImageIcon,
  Clapperboard,
  AudioLines,
  Music,
  Globe,
} from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { useStudioAgentStore, AGENT_META } from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useCanonicalConversation } from "../hooks/useCanonicalConversation";
import { useConversationStore } from "../stores/useConversationStore";
import { useLiTTRealtimeSession } from "../hooks/useLiTTRealtimeSession";
import type { LiTTLiveSessionContext } from "@/lib/litt/live/types";
import type { ArtifactAction } from "@/lib/canvas/types";

import CommandStudioHeader from "./CommandStudioHeader";
import PersistentMusicPlayer from "./PersistentMusicPlayer";
import { MobileCommandNav } from "./CommandStudioNav";
import CommandComposer, { type ComposerContextLine } from "./CommandComposer";
import LiTEmptyState from "./LiTEmptyState";
import StudioTranscript from "./StudioTranscript";
import LiTTLiveActivity from "./LiTTLiveActivity";
import LiTTPanel from "./LiTTPanel";
import { useExecutionStore } from "../stores/useExecutionStore";
import { StudioActivityPanel, StudioInspector, StudioDrawer } from "./StudioWorkspaceFrame";
import StudioProjectFiles from "./StudioProjectFiles";
import { MediaUtilityDock } from "@/components/media/MediaUtilityDock";
import {
  mapLegacyToolToDestination,
  destinationToLegacyTool,
  type StudioDestination,
  type StudioMode,
  type CreateMode,
  type MoreMode,
  type MissionMode,
  type InspectorTab,
  type DrawerTab,
} from "../lib/studio-destinations";
import type { StudioTool } from "./StudioSidebar";

/* ── Legacy tool components (loaded through adapters) ──────────── */
// ChatTool is NOT mounted here — the conversation controller
// (useStudioConversation) + StudioTranscript + CommandComposer replace it.
const CanvasPanel = dynamic(() => import("./canvas/CanvasPanel").then((m) => m.CanvasPanel), { ssr: false });
const VisualCanvasBuilder = dynamic(() => import("./canvas/builder/VisualCanvasBuilder").then((m) => m.VisualCanvasBuilder), { ssr: false });
const CodeWorkspace = dynamic(() => import("./code/CodeWorkspace").then((m) => m.CodeWorkspace), { ssr: false });
const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });
const AudioTool = dynamic(() => import("../tools/AudioTool"), { ssr: false });
const MusicTool = dynamic(() => import("../tools/MusicTool"), { ssr: false });
const BuilderTool = dynamic(() => import("../tools/BuilderTool"), { ssr: false });
const StudioPreviewPanel = dynamic(() => import("./StudioPreviewPanel"), { ssr: false });
const CanvasTool = dynamic(() => import("../tools/CanvasTool"), { ssr: false });
const DesignCanvas = dynamic(() => import("../tools/DesignCanvas"), { ssr: false });
const AgentTool = dynamic(() => import("../tools/AgentTool"), { ssr: false });
const GalleryTool = dynamic(() => import("../tools/GalleryTool"), { ssr: false });
const StudioTerminalDrawer = dynamic(() => import("./StudioTerminalDrawer"), { ssr: false });
const MissionForge = dynamic(() => import("../tools/MissionForge"), { ssr: false });
const CLIBridgeTool = dynamic(() => import("../tools/CLIBridgeTool"), { ssr: false });
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });
const PluginsTool = dynamic(() => import("../tools/PluginsTool"), { ssr: false });
const CameraTool = dynamic(() => import("../tools/CameraTool"), { ssr: false });
const ScreenTool = dynamic(() => import("../tools/ScreenTool"), { ssr: false });
const LiveVoiceOverlay = dynamic(() => import("./LiveVoiceOverlay"), { ssr: false });

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
const TOOL_COMPONENTS: Partial<Record<StudioTool, React.ComponentType<Record<string, unknown>>>> = {
  canvas: CanvasTool,
  design: DesignCanvas,
  image: ImageTool,
  video: VideoTool,
  audio: AudioTool,
  music: MusicTool,
  build: BuilderTool,
  agents: AgentTool,
  assets: GalleryTool,
  plugins: PluginsTool,
  camera: CameraTool,
  screen: ScreenTool,
  workflows: MissionForge,
  space: SpaceTool,
  clibridge: CLIBridgeTool,
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
  return (
    <VoiceSessionProvider>
      <CommandStudioContent />
    </VoiceSessionProvider>
  );
}

function CommandStudioContent() {
  const { theme } = useTheme();
  const { userId, getToken } = useClerkAuth();
  const { user: appUser } = useAppUser();
  const { profile } = useProfile();
  const userDisplayName = appUser?.firstName ?? appUser?.fullName ?? null;
  const profileDisplayName = profile?.displayName ?? userDisplayName;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { capabilities, refresh: refreshCapabilities } = useConnectionSummary();
  const projectReady = Boolean(capabilities.projectId);
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);
  const executionMode = useStudioAgentStore((s) => s.executionMode);
  const setExecutionMode = useStudioAgentStore((s) => s.setExecutionMode);
  // Look up health by provider first, then fall back to apiProvider
  // (e.g. "Auto" models route to "gemini" under the hood).
  const modelHealth = providerHealth[selectedModel.provider] ?? providerHealth[selectedModel.apiProvider ?? ""];
  const modelLabel = selectedModel.label;

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
  const [missionMode, setMissionMode] = useState<MissionMode>((initial.mode as MissionMode) ?? "overview");
  const [, setPendingCommand] = useState<string>(initial.command ?? "");
  const [composerValue, setComposerValue] = useState("");
  // Dynamic Work surface — not derived from initial.legacyTool after init.
  const [workSurface, setWorkSurface] = useState<WorkSurface>(
    initial.legacyTool === "build" ? "builder" : "conversation",
  );

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(initial.openInspector ?? "plan");
  const [drawerOpen, setDrawerOpen] = useState<boolean>(!!initial.openDrawer);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(initial.openDrawer ?? "activity");

  // ── URL → State synchronization (browser back/forward) ───────────
  // When the URL changes (back/forward navigation), update React state
  // to match. Only updates when the canonical value actually changed,
  // preventing update loops with the state→URL effect below.
  useEffect(() => {
    const fromUrl = searchParams.get("tool");
    const mapped = mapLegacyToolToDestination(
      fromUrl === "pipeline" ? "workflows" : fromUrl,
      searchParams.get("mission") ?? undefined,
    );
    setDestination((cur) => (cur === mapped.destination ? cur : mapped.destination));
    if (mapped.destination === "studio") {
      const newMode = (mapped.mode as StudioMode) ?? "work";
      setStudioMode((cur) => (cur === newMode ? cur : newMode));
    }
    if (mapped.destination === "create") {
      const newMode = (mapped.mode as CreateMode) ?? "image";
      setCreateMode((cur) => (cur === newMode ? cur : newMode));
    }
    if (mapped.destination === "more") {
      const newMode = (mapped.mode as MoreMode) ?? "plugins";
      setMoreMode((cur) => (cur === newMode ? cur : newMode));
    }
    if (mapped.destination === "missions") {
      const newMode = (mapped.mode as MissionMode) ?? "overview";
      setMissionMode((cur) => (cur === newMode ? cur : newMode));
    }
  }, [searchParams]);

  // ── Unified side panel manager ────────────────────────────────────
  // Only ONE side panel may be open at a time. Opening one closes the
  // others. The canvas immediately reclaims width when a panel closes.
  // New users start with no side panel. The last choice persists.
  type StudioSidePanel = "none" | "activity" | "inspector" | "settings";
  const SIDE_PANEL_STORAGE_KEY = "littree:studio:side-panel";
  const [sidePanel, setSidePanel] = useState<StudioSidePanel>(() => {
    if (typeof window === "undefined") return "none";
    try {
      const stored = localStorage.getItem(SIDE_PANEL_STORAGE_KEY);
      if (stored === "activity" || stored === "inspector" || stored === "settings") return stored;
      return "none";
    } catch {
      return "none";
    }
  });

  // Backwards-compat: if old activity-rail-open key was "true", migrate
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const oldKey = localStorage.getItem("littree:studio:activity-rail-open");
      if (oldKey === "true" && sidePanel === "none") {
        setSidePanel("activity");
        localStorage.removeItem("littree:studio:activity-rail-open");
      }
    } catch {
      // Ignore storage errors.
    }
  }, [sidePanel]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_PANEL_STORAGE_KEY, sidePanel);
    } catch {
      // Ignore unavailable storage.
    }
  }, [sidePanel]);

  // Derived booleans for downstream components
  const activityRailOpen = sidePanel === "activity";
  const inspectorOpen = sidePanel === "inspector";

  // LiTT Live Activity panel — right side, open by default on desktop.
  // Shows real-time execution events (tool calls, diffs, checks, approvals).
  const [littLiveOpen, setLittLiveOpen] = useState(true);

  // Toggle helpers — opening one closes the others
  const handleToggleActivity = useCallback(() => {
    setLittLiveOpen((v) => !v);
  }, []);
  const handleToggleInspector = useCallback(() => {
    setSidePanel((current) => (current === "inspector" ? "none" : "inspector"));
  }, []);

  // Keyboard shortcut: Ctrl+Shift+A toggles the Activity panel.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        handleToggleActivity();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleActivity]);

  const [cameraDock, setCameraDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "top-right" });
  const [cameraStatus, setCameraStatus] = useState<string>("idle");
  const [screenDock, setScreenDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "bottom-left" });
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [pendingCanvasAction, setPendingCanvasAction] = useState<ArtifactAction | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [healthRunTrigger, setHealthRunTrigger] = useState(0);

  // Collapsible Files / Components panel — sits between the shared sidebar
  // and the workspace. Toggled by the Files button in the tab bar.
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);

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
    if (mapped.destination === "missions") setMissionMode((mapped.mode as MissionMode) ?? "overview");
    if (mapped.destination === "more") setMoreMode((mapped.mode as MoreMode) ?? "plugins");
    if (mapped.openDrawer) {
      const terminalNeedsExplicitConnect =
        mapped.openDrawer === "terminal" && capabilities.terminalStatus !== "connected" && !command;
      if (!terminalNeedsExplicitConnect) {
        setDrawerOpen(true);
        setDrawerTab(mapped.openDrawer);
      }
    }
    if (mapped.openInspector) {
      setSidePanel("inspector");
      setInspectorTab(mapped.openInspector);
    }
    setPendingCommand(command);
  }, [capabilities.terminalStatus]);

  // The single conversation controller — calls canonical V12 API.
  const conversation = useCanonicalConversation({
    onRouteToolAction: handleRouteTool,
    onRouteInspectorAction: (tab) => {
      setInspectorTab(tab);
      setSidePanel("inspector");
    },
    onRunHealthChecks: () => {
      // Open the checks panel and trigger run-all
      setInspectorTab("checks");
      setSidePanel("inspector");
      setHealthRunTrigger((n) => n + 1);
    },
    serverProjectId: capabilities.projectId,
    cameraState: { active: cameraDock.open, status: cameraStatus },
  });

  // ── LiTT Live realtime session ──
  const liveSession = useLiTTRealtimeSession();

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

  const handleSelectProject = useCallback((projectId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", projectId);
    params.delete("conversation");
    params.delete("agentInstance");
    setWorkspaceRevision(0);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  // Header actions — truthful.
  const handlePreview = useCallback(() => {
    setDestination("studio");
    setStudioMode("preview");
  }, []);
  const handleOpenTerminal = useCallback(() => {
    setDestination("studio");
    setStudioMode("work");
    setWorkSurface("conversation");
    setDrawerOpen(true);
    setDrawerTab("terminal");
  }, []);

  // Real rollback: call restore_checkpoint via the Studio API (git reset --hard <sha>).
  // Falls back to opening Terminal if no checkpoint or API call fails.
  const handleRollback = useCallback(async () => {
    const ckpt = useExecutionStore.getState().checkpoint;
    if (!ckpt?.gitSha || !capabilities.projectId) {
      handleOpenTerminal();
      return;
    }
    try {
      const res = await fetch("/api/studio/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: capabilities.projectId, sha: ckpt.gitSha }),
      });
      if (res.ok) {
        void refreshCapabilities();
      } else {
        handleOpenTerminal();
      }
    } catch {
      handleOpenTerminal();
    }
  }, [capabilities.projectId, handleOpenTerminal, refreshCapabilities]);

  // Context line for the composer.
  const contextLine: ComposerContextLine = useMemo(() => ({
    repo: capabilities.repositoryName ?? undefined,
    branch: capabilities.activeBranch ?? (typeof window !== "undefined" ? (searchParams.get("branch") ?? undefined) : undefined),
    permissionMode: capabilities.writeAccess ? "Writes allowed" : "Writes require approval",
  }), [capabilities.activeBranch, capabilities.repositoryName, capabilities.writeAccess, searchParams]);

  // P0.13: Select a conversation from the empty state's Recent Chats section.
  const handleSelectConversation = useCallback((conversationId: string) => {
    const store = useConversationStore.getState();
    store.selectConversation(conversationId);
    void conversation.loadMessages(conversationId);
  }, [conversation]);

  // ── LiTT Live session context (must be after contextLine) ──
  const liveContext = useMemo<LiTTLiveSessionContext>(() => ({
    userId: userId ?? "unknown",
    userName: profile?.displayName ?? appUser?.username ?? undefined,
    projectId: capabilities.projectId || undefined,
    projectName: capabilities.projectName || undefined,
    repository: capabilities.repositoryName || undefined,
    branch: capabilities.activeBranch || contextLine.branch,
    currentTool: destination === "studio" ? studioMode : destination === "create" ? createMode : destination,
    approvedTools: capabilities.writeAccess ? ["terminal", "files"] : [],
    conversationId: conversation.selectedConversationId ?? undefined,
    agentSlug: conversation.activeAgentId as string | undefined,
  }), [userId, profile, appUser, capabilities, contextLine, destination, studioMode, createMode, conversation.selectedConversationId, conversation.activeAgentId]);

  // Sync Live transcripts into canonical conversation (P0.4 fix)
  // Instead of calling conversation.send() (which triggers a second LLM call),
  // we accumulate user+assistant transcripts and persist them directly.
  const liveTurnAccumulator = useRef<{ userText: string; assistantText: string }>({
    userText: "",
    assistantText: "",
  });

  const handleLiveTranscript = useCallback(async (role: "user" | "assistant", text: string) => {
    if (!text.trim()) return;

    // Accumulate the turn parts
    if (role === "user") {
      liveTurnAccumulator.current.userText = text.trim();
    } else {
      liveTurnAccumulator.current.assistantText = text.trim();
    }

    // Only persist when we have BOTH user and assistant text
    const { userText, assistantText } = liveTurnAccumulator.current;
    if (!userText || !assistantText) return;

    // Reset accumulator
    liveTurnAccumulator.current = { userText: "", assistantText: "" };

    // Get the active conversation ID
    const convId = conversation.selectedConversationId;
    if (!convId) return;

    // Add messages to the local store immediately (optimistic)
    const liveTurnId = `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const store = useConversationStore.getState();
    store.addMessage(convId, {
      id: `live_user_${liveTurnId}`,
      role: "user",
      content: userText,
      agentSlug: null,
      agentMode: null,
      status: "completed",
      createdAt: timestamp,
      parentMessageId: null,
      regenerationOfMessageId: null,
    });
    store.addMessage(convId, {
      id: `live_assistant_${liveTurnId}`,
      role: "assistant",
      content: assistantText,
      agentSlug: (liveContext.agentSlug ?? "litt") as import("@/lib/studio/types").AgentSlug,
      agentMode: "standard",
      status: "completed",
      createdAt: timestamp,
      parentMessageId: null,
      regenerationOfMessageId: null,
    });

    // Persist to server (no LLM call — direct message storage)
    try {
      const token = await getToken?.();
      const res = await fetch(`/api/studio/conversations/${convId}/live-transcript`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          userText,
          assistantText,
          liveTurnId,
          timestamp: Date.now(),
        }),
      });
      if (res.ok) {
        const data = await res.json() as {
          userMessage: { id: string; createdAt: string };
          assistantMessage: { id: string; createdAt: string };
          revision: number;
        };
        // Replace optimistic IDs with server IDs
        store.updateMessage(convId, `live_user_${liveTurnId}`, {
          id: data.userMessage.id,
          createdAt: data.userMessage.createdAt,
        });
        store.updateMessage(convId, `live_assistant_${liveTurnId}`, {
          id: data.assistantMessage.id,
          createdAt: data.assistantMessage.createdAt,
        });
        store.setRevision(data.revision);
      }
    } catch {
      // Non-fatal — messages are already in the local store
    }
  }, [conversation.selectedConversationId, liveContext.agentSlug, getToken]);

  // Resolve the legacy tool to render for the active destination/mode.
  // Studio/Work renders the conversation (transcript + composer) unless
  // the legacy tool is "build" (Builder adapter) — not ChatTool.
  const activeLegacyTool: StudioTool | null = useMemo(() => {
    if (destination === "studio") {
      if (studioMode === "code") return "code";
      if (studioMode === "files") return "canvas";
      if (studioMode === "preview") return "preview";
      // Work mode: dynamic surface state, not initial URL
      return workSurface === "builder" ? "build" : null;
    }
    if (destination === "create") {
      if (createMode === "video") return "video";
      if (createMode === "audio") return "audio";
      if (createMode === "music") return "music";
      if (createMode === "environment") return "space";
      return "image";
    }
    if (destination === "assets") return "assets";
    if (destination === "agents") return "agents";
    if (destination === "missions") return "workflows";
    if (destination === "more") return moreMode as StudioTool;
    return null;
  }, [destination, studioMode, createMode, moreMode, workSurface]);

  const WorkspaceComponent = activeLegacyTool ? TOOL_COMPONENTS[activeLegacyTool] : null;
  const isCanvas = destination === "studio" && studioMode === "files";
  const isCode = destination === "studio" && studioMode === "code";
  const isPreview = destination === "studio" && studioMode === "preview";

  // Primary workspace tabs — Canvas | Code | Preview only.
  // Chat lives inside the LiTT right panel (Chat | Live tabs).
  // Files/Components live in the contextual left drawer.
  const primaryTabs: { id: string; label: string; destination: StudioDestination; mode?: StudioMode | CreateMode }[] = [
    { id: "canvas", label: "Canvas", destination: "studio", mode: "files" },
    { id: "code", label: "Code", destination: "studio", mode: "code" },
    { id: "preview", label: "Preview", destination: "studio", mode: "preview" },
  ];

    // Create secondary tabs — visible only when Create is active
  const createTabs: { id: CreateMode; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }[] = [
    { id: "image", label: "Image", icon: ImageIcon },
    { id: "video", label: "Video", icon: Clapperboard },
    { id: "audio", label: "Audio", icon: AudioLines },
    { id: "music", label: "Music", icon: Music },
    { id: "environment", label: "360° Env", icon: Globe },
  ];

  return (
    <>
      <AgentVoiceSync />

      <div
        className="studio-shell flex h-dvh w-full flex-col overflow-hidden"
        data-layout={theme.layoutStyle}
        style={{
          backgroundColor: "var(--bg-main)",
          color: "var(--text-main)",
          backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139,92,246,0.06), transparent)",
        }}
      >
        {/* One compact header — replaces AutonomicLoopBanner + StudioTopBar */}
        <CommandStudioHeader
          branch={contextLine.branch}
          onPreviewAction={handlePreview}
          onOpenActivityAction={handleToggleActivity}
          activityRailOpen={activityRailOpen}
          onOpenTerminalAction={handleOpenTerminal}
          onOpenInspectorAction={handleToggleInspector}
          onProjectSelectAction={handleSelectProject}
          onClearChatAction={conversation.clear}
          onNewChatAction={() => { void conversation.createConversation(); }}
          onDeleteChatAction={() => { void conversation.deleteConversation(); }}
          onRenameChatAction={() => {
            const title = window.prompt("Rename conversation:", conversation.conversations.find((c) => c.id === conversation.selectedConversationId)?.title ?? "");
            if (title) void conversation.renameConversation(title);
          }}
          onExportChatAction={() => conversation.exportConversation()}
          hasConversation={Boolean(conversation.selectedConversationId)}
          projectReady={projectReady}
          capabilities={capabilities}
          busy={conversation.busy}
        />

        {/* Body: workspace + inspector.
            The desktop nav rail (CommandStudioNav) has been removed — the
            unified AppShell sidebar now provides global navigation.
            Studio's internal tabs (Chat/Canvas/Code/Preview/Files) remain. */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden overflow-x-hidden">
            {/* Persistent primary workspace switcher: Chat | Canvas | Code | Preview */}
            <div
              className="glass-shell flex shrink-0 items-center gap-0.5 border-b px-2"
              style={{
                height: 36,
                backgroundColor: "rgba(13,9,22,0.85)",
                borderColor: "rgba(155,77,255,0.1)",
              }}
            >
              {primaryTabs.map((t) => {
                const isActive = t.destination === "studio"
                  ? destination === "studio" && studioMode === t.mode
                  : destination === t.destination;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (t.destination === "studio") {
                        setDestination("studio");
                        setStudioMode(t.mode as StudioMode);
                        if (t.mode === "work") setWorkSurface("conversation");
                      } else {
                        setDestination(t.destination);
                      }
                    }}
                    className={`relative rounded-md px-3 py-1.5 text-[13px] font-bold transition-all ${isActive ? "glass-active" : ""}`}
                    style={{
                      color: isActive ? "var(--text-main)" : "var(--text-dim)",
                      backgroundColor: isActive ? "var(--purple-soft)" : "transparent",
                    }}
                    aria-label={t.label}
                  >
                    {t.label}
                    {isActive && (
                      <span
                        className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full"
                        style={{
                          background: "var(--purple)",
                          boxShadow: "0 0 6px rgba(139,92,246,0.5)",
                        }}
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}

              {/* Files / Components toggle — collapsible left panel */}
              <button
                type="button"
                onClick={() => setFilesPanelOpen((v) => !v)}
                className={`relative rounded-md px-3 py-1.5 text-[13px] font-bold transition-all ${filesPanelOpen ? "glass-active" : ""}`}
                style={{
                  color: filesPanelOpen ? "var(--text-main)" : "var(--text-dim)",
                  backgroundColor: filesPanelOpen ? "var(--purple-soft)" : "transparent",
                }}
                aria-label="Files"
                aria-pressed={filesPanelOpen}
              >
                Files
                {filesPanelOpen && (
                  <span
                    className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full"
                    style={{
                      background: "var(--purple)",
                      boxShadow: "0 0 6px rgba(139,92,246,0.5)",
                    }}
                    aria-hidden
                  />
                )}
              </button>
            </div>

            {/* Create secondary tabs: Image | Video | Audio | Music — only when Create is active */}
            {destination === "create" && (
              <div
                className="glass-shell flex shrink-0 items-center gap-0.5 border-b px-2"
                style={{
                  height: 36,
                  backgroundColor: "rgba(13,9,22,0.85)",
                  borderColor: "rgba(155,77,255,0.1)",
                }}
              >
                {createTabs.map((t) => {
                  const isActive = createMode === t.id;
                  const TabIcon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCreateMode(t.id)}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-bold transition-all ${isActive ? "glass-active" : ""}`}
                      style={{
                        color: isActive ? "var(--purple)" : "var(--text-dim)",
                        backgroundColor: isActive ? "var(--purple-soft)" : "transparent",
                      }}
                      aria-label={t.label}
                    >
                      <TabIcon size={13} strokeWidth={isActive ? 2.2 : 1.7} className="pointer-events-none" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Workspace content — Files/Components panel + main workspace + LiTT Live Activity */}
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {/* Collapsible Files / Components panel — sits between shared sidebar and workspace */}
              {filesPanelOpen && (
                <div
                  className="hidden shrink-0 flex-col overflow-hidden border-r md:flex"
                  style={{
                    width: 240,
                    backgroundColor: "var(--studio-surface)",
                    borderRight: "1px solid var(--studio-border)",
                  }}
                  data-testid="studio-files-panel"
                >
                  <div
                    className="flex shrink-0 items-center justify-between border-b px-2.5 py-2"
                    style={{ borderColor: "var(--studio-border)" }}
                  >
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.12em]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Files / Components
                    </span>
                    <button
                      type="button"
                      onClick={() => setFilesPanelOpen(false)}
                      className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/10"
                      style={{ color: "var(--text-muted)" }}
                      aria-label="Close Files panel"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto studio-scroll">
                    <StudioProjectFiles
                      projectId={capabilities.projectId}
                      repositoryName={capabilities.repositoryName}
                      branch={capabilities.activeBranch ?? capabilities.defaultBranch}
                      workspaceStatus={capabilities.workspaceStatus}
                      writeAccess={capabilities.writeAccess}
                      onSaved={() => setWorkspaceRevision((value) => value + 1)}
                      onMutation={() => setWorkspaceRevision((value) => value + 1)}
                      onWorkspacePrepared={() => { void refreshCapabilities(); }}
                    />
                  </div>
                </div>
              )}

              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {isCanvas ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <VisualCanvasBuilder />
                  </div>
                ) : isCode ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <CodeWorkspace
                      projectId={capabilities.projectId}
                      repositoryName={capabilities.repositoryName}
                      branch={capabilities.activeBranch}
                      workspaceStatus={capabilities.workspaceStatus ?? null}
                      writeAccess={capabilities.writeAccess ?? true}
                    />
                  </div>
                ) : isPreview ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <StudioPreviewPanel
                      projectId={capabilities.projectId}
                      projectName={capabilities.projectName}
                      repositoryName={capabilities.repositoryName}
                      branch={capabilities.activeBranch}
                      workspaceStatus={capabilities.workspaceStatus ?? null}
                    />
                  </div>
                ) : WorkspaceComponent ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <WorkspaceComponent projectId={capabilities.projectId} />
                  </div>
                ) : (
                  <StudioUnavailableSurface
                    destination={destination}
                    capabilities={capabilities}
                    modelLabel={modelLabel}
                  />
                )}
              </div>

              {/* Right inspector — folded into LiTT Live Activity panel.
                  StudioInspector is no longer rendered as a permanent column.
                  Files/checks/context are accessible via the LiTT Live panel
                  and the Files drawer. */}

            </div>

            {/* Bottom drawer — collapsed by default, sits above composer */}
            <StudioDrawer
              open={drawerOpen}
              onToggle={() => setDrawerOpen((v) => !v)}
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
            >
              {/* Keep the terminal mounted in the background to handle auto-connect and keep PTY alive */}
              <div style={{ display: drawerTab === "terminal" ? "block" : "none", height: "100%" }}>
                <StudioTerminalDrawer
                  projectId={capabilities.projectId}
                  repositoryName={capabilities.repositoryName}
                  branch={capabilities.activeBranch ?? capabilities.defaultBranch}
                  visible={drawerOpen && drawerTab === "terminal"}
                />
              </div>

              {/* Render others conditionally since they don't have background workers */}
              {drawerOpen && drawerTab === "media" && <MediaUtilityDock />}
              {drawerOpen && drawerTab === "activity" && (
                <StudioActivityPanel
                  messages={conversation.messages}
                  busy={conversation.busy}
                  modelLabel={modelLabel}
                  projectName={capabilities.projectName}
                  terminalStatus={capabilities.terminalStatus}
                />
              )}
            </StudioDrawer>
          </main>

          {/* LiTT Panel — right side. One agent, two views: Chat | Live.
              Chat = conversation transcript + composer
              Live = real-time execution telemetry
              Both tabs share the same conversation/execution state. */}
          {littLiveOpen && (
            <LiTTPanel
              onClose={() => setLittLiveOpen(false)}
              chatContent={
                <>
                  <StudioWorkSurface
                    messages={conversation.messages}
                    busy={conversation.busy}
                    loading={conversation.loading}
                    activeAgentId={conversation.activeAgentId}
                    fallbackNotice={conversation.fallbackNotice}
                    onRouteToolAction={handleRouteTool}
                    onRegenerateAction={conversation.regenerate}
                    onEmptyAction={handleEmptyAction}
                    onSelectConversation={handleSelectConversation}
                    hasProject={projectReady}
                    projectName={capabilities.projectName}
                    sourceType={capabilities.sourceType}
                    githubInstalled={capabilities.githubInstalled}
                    capabilities={capabilities}
                    modelHealth={modelHealth}
                    modelLabel={modelLabel}
                    displayName={profileDisplayName}
                    onStartBlank={handleStartBlank}
                    onConnectRepo={handleConnectRepo}
                  />
                  {(conversation.requiresReauth || conversation.sendError) && (
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
                  <CommandComposer
                    value={composerValue}
                    onChange={setComposerValue}
                    onSend={handleComposerSend}
                    onCancel={conversation.cancel}
                    busy={conversation.busy || creatingProject}
                    disabled={conversation.requiresReauth}
                    onToggleCamera={() => setCameraDock((v) => ({ ...v, open: !v.open }))}
                    onToggleLive={() => setLivePanelOpen((v) => !v)}
                    liveActive={livePanelOpen && liveSession.isLive}
                    contextLine={contextLine}
                    executionMode={executionMode}
                    onExecutionModeChange={setExecutionMode}
                  />
                </>
              }
              liveContent={
                <LiTTLiveActivity
                  onOpenFile={(_filePath) => {
                    setDestination("studio");
                    setStudioMode("code");
                  }}
                  onOpenDiff={() => {
                    setDrawerOpen(true);
                    setDrawerTab("activity");
                  }}
                  onOpenCheck={() => {
                    setDrawerOpen(true);
                    setDrawerTab("terminal");
                  }}
                  onOpenTerminal={handleOpenTerminal}
                  onStop={() => {
                    conversation.cancel();
                    useExecutionStore.getState().endRun("cancelled");
                  }}
                  onRollback={handleRollback}
                  onResolveApproval={(decision) => {
                    const pending = useExecutionStore.getState().pendingApproval;
                    if (pending?.pausedRunId && conversation.selectedConversationId) {
                      void fetch(`/api/studio/conversations/${conversation.selectedConversationId}/approvals/${pending.pausedRunId}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ decision }),
                      }).then(() => {
                        useExecutionStore.getState().resolveApproval(decision);
                        conversation.regenerate();
                      });
                    } else {
                      useExecutionStore.getState().resolveApproval(decision);
                    }
                  }}
                />
              }
            />
          )}
        </div>

        {/* Persistent music player — survives tool switches while audio plays */}
        <PersistentMusicPlayer />

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
        onCameraClose={() => { setCameraDock((v) => ({ ...v, open: false })); setCameraStatus("idle"); }}
        onScreenClose={() => setScreenDock((v) => ({ ...v, open: false }))}
        onCameraPosChange={(pos) => setCameraDock((v) => ({ ...v, pos }))}
        onScreenPosChange={(pos) => setScreenDock((v) => ({ ...v, pos }))}
        onCameraStatusChange={setCameraStatus}
      />

      {/* LiTT Live — centered overlay for realtime voice + vision session.
          Replaces the old side panel with a proper fullscreen overlay. */}
      {livePanelOpen && (
        <LiveVoiceOverlay
          session={liveSession}
          context={liveContext}
          onTranscript={handleLiveTranscript}
          onEnd={() => setLivePanelOpen(false)}
        />
      )}

    </>
  );
}

function StudioUnavailableSurface({
  destination,
  capabilities,
  modelLabel,
}: {
  destination: StudioDestination;
  capabilities: import("../hooks/useConnectionSummary").ConnectionCapabilities;
  modelLabel: string;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-8" aria-live="polite">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border p-5" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--litt-primary)" }}>{destination}</div>
          <h2 className="mt-1 text-lg font-black" style={{ color: "var(--text-primary)" }}>Pick a workspace</h2>
          <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--text-secondary)" }}>
            Select a tool from the sidebar or pick one below to get started.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Chat", desc: "Talk to LiTT", dest: "studio" as const, mode: "work" as const },
            { label: "Create", desc: "Image, video, audio", dest: "create" as const, mode: "image" as const },
            { label: "Code", desc: "Edit project files", dest: "studio" as const, mode: "code" as const },
            { label: "Preview", desc: "Live preview", dest: "studio" as const, mode: "preview" as const },
          ].map((tool) => (
            <a
              key={tool.label}
              href={`?tool=${tool.dest === "studio" ? (tool.mode === "work" ? "chat" : tool.mode === "preview" ? "preview" : "code") : tool.mode}`}
              className="block rounded-lg border p-3 transition hover:opacity-80"
              style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
            >
              <div className="text-[11px] font-black" style={{ color: "var(--text-primary)" }}>{tool.label}</div>
              <div className="mt-0.5 text-[9px]" style={{ color: "var(--text-muted)" }}>{tool.desc}</div>
            </a>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Project</span><div className="mt-1 truncate font-bold" style={{ color: "var(--text-primary)" }}>{capabilities.projectName ?? "Not selected"}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Model</span><div className="mt-1 truncate font-bold" style={{ color: "var(--text-primary)" }}>{modelLabel}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Repository</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.repository === "connected" ? "var(--litt-primary)" : "var(--text-primary)" }}>{capabilities.repositoryName ?? "Not connected"}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Terminal</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.terminalStatus === "connected" ? "var(--litt-primary)" : "var(--text-primary)" }}>{capabilities.terminalStatus}</div></div>
        </div>
      </div>
    </div>
  );
}

/* ── Studio/Work surface: empty state OR real transcript ──────── */
function StudioWorkSurface({
  messages,
  busy,
  loading,
  activeAgentId,
  fallbackNotice,
  onRouteToolAction,
  onRegenerateAction,
  onEmptyAction,
  onSelectConversation,
  hasProject,
  projectName,
  sourceType,
  githubInstalled,
  capabilities,
  modelHealth,
  modelLabel,
  displayName,
  onStartBlank,
  onConnectRepo,
}: {
  messages: import("../stores/useStudioAgentStore").ChatMessage[];
  busy: boolean;
  loading: boolean;
  activeAgentId: import("../stores/useStudioAgentStore").AgentId;
  fallbackNotice: string | null;
  onRouteToolAction: (tool: StudioTool, command?: string) => void;
  onRegenerateAction: () => void;
  onEmptyAction: (prompt: string) => void;
  onSelectConversation?: (conversationId: string) => void;
  hasProject: boolean;
  projectName: string | null;
  sourceType: "github" | "blank" | "template" | "upload" | null;
  githubInstalled: boolean;
  capabilities: import("../hooks/useConnectionSummary").ConnectionCapabilities;
  modelHealth: import("../stores/useStudioModelStore").ProviderHealth | undefined;
  modelLabel: string | undefined;
  displayName?: string | null;
  onStartBlank: () => void;
  onConnectRepo: () => void;
}) {
  // P0.14-15: Only show empty state when messages are truly empty AND
  // conversations have finished loading from the server. During loading,
  // show a minimal spinner so users don't see the welcome screen flash.
  const isEmpty = messages.length === 0 && !loading;
  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        background: "linear-gradient(180deg, var(--studio-surface) 0%, rgba(13,9,22,0.96) 100%)",
      }}
      data-studio-surface
    >
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
            capabilities={capabilities}
            modelHealth={modelHealth}
            modelLabel={modelLabel}
            displayName={displayName}
            onPickAction={onEmptyAction}
            onStartBlankAction={onStartBlank}
            onConnectRepoAction={onConnectRepo}
            onSelectConversation={onSelectConversation}
          />
        </div>
      ) : loading && messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--litt-primary)", borderTopColor: "transparent" }}
            aria-label="Loading conversations"
          />
        </div>
      ) : (
        <StudioTranscript
          messages={messages}
          busy={busy}
          activeAgentId={activeAgentId}
          onRouteToolAction={onRouteToolAction}
          onRegenerateAction={onRegenerateAction}
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
  onCameraStatusChange,
}: {
  cameraDock: { open: boolean; pos: DockPosition };
  screenDock: { open: boolean; pos: DockPosition };
  onCameraClose: () => void;
  onScreenClose: () => void;
  onCameraPosChange: (pos: DockPosition) => void;
  onScreenPosChange: (pos: DockPosition) => void;
  onCameraStatusChange?: (status: string) => void;
}) {
  if (!cameraDock.open && !screenDock.open) return null;
  return (
    <>
      {cameraDock.open && (
        <CameraDock pos={cameraDock.pos} onClose={onCameraClose} onMove={() => onCameraPosChange(nextPos(cameraDock.pos))} onStatusChange={onCameraStatusChange} />
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

function CameraDock({ pos, onClose, onMove, onStatusChange }: { pos: DockPosition; onClose: () => void; onMove: () => void; onStatusChange?: (status: string) => void }) {
  return (
    <DockFrame pos={pos} label="Camera" onClose={onClose} onMove={onMove}>
      <CameraTool onStatusChange={onStatusChange} />
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
