"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Image as ImageIcon } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth, useAppUser } from "@/hooks/useClerkAuth";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import { LiTTRuntimeProvider } from "../context/LiTTRuntimeContext";
import { useStudioAgentStore, AGENT_META } from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useVoiceStore } from "@/features/voice/store/useVoiceStore";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useCanonicalConversation } from "../hooks/useCanonicalConversation";
import { useConversationStore } from "../stores/useConversationStore";
import { useLiTTRealtimeSession } from "../hooks/useLiTTRealtimeSession";
import type { LiTTLiveSessionContext } from "@/lib/litt/live/types";
import type { ArtifactAction } from "@/lib/canvas/types";
import { STUDIO_EVENT_OPEN_DOCK, STUDIO_EVENT_OPEN_FILE, STUDIO_EVENT_REQUEST_DEPLOY } from "@/lib/canvas/panel-actions";
import { INITIAL_RUNTIME_STATE, deriveExecutionHint } from "@/lib/projects/runtime-state";
import { useLiTTRuntime } from "@/hooks/useLiTTRuntime";

import CommandStudioHeader from "./CommandStudioHeader";
import StudioDock, { type StudioDockTab } from "./StudioDock";
import { ApprovalCard } from "./ApprovalCard";
import MissionCards from "./MissionCards";
import PersistentMusicPlayer from "./PersistentMusicPlayer";
import { MobileCommandNav } from "./CommandStudioNav";
import CommandComposer, { type ComposerContextLine } from "./CommandComposer";
import LiTEmptyState from "./LiTEmptyState";
import StudioTranscript from "./StudioTranscript";
import { ActionRunStatusPanel } from "./ActionRunStatusPanel";
import LiTTLiveActivity from "./LiTTLiveActivity";
import LiTTPanel from "./LiTTPanel";
import LiTTMobileSheet from "./litt/LiTTMobileSheet";
import MobileBuildStatusBar from "./litt/MobileBuildStatus";
import MobileToolsSheet from "./litt/MobileToolsSheet";
import MobileBottomSheet from "./sheets/MobileBottomSheet";
import MobileDiagOverlay from "./MobileDiagOverlay";
import { mobileDiag, isMobileDiagEnabled } from "../lib/mobileDiagnostics";
import ContextDrawer, { type ContextDrawerTab } from "./context/ContextDrawer";
import AssetsPanel from "./context/AssetsPanel";
import { StudioContextProvider, type StudioSelection } from "../context/StudioContext";
import { deriveCreator, deriveWorkspaceStage } from "../context/derive-studio-context";
import { StudioCreatorHost } from "./creators/StudioCreatorHost";
import { useViewportTier } from "../hooks/useViewportTier";
import ResizeHandle from "./shell/ResizeHandle";
import { useResizableWidth } from "../hooks/useResizableWidth";
import { useExecutionStore, type MutationSummary } from "../stores/useExecutionStore";
import { submitApprovalAndPoll, watchApprovalResolution, type ApprovalRunResult } from "../lib/approval-polling";
import { StudioActivityPanel, StudioInspector } from "./StudioWorkspaceFrame";
import type { PreviewSelection } from "./StudioPreviewPanel";
import StudioProjectFiles from "./StudioProjectFiles";
import ProjectNameDialog from "./ProjectNameDialog";
import { MediaUtilityDock } from "@/components/media/MediaUtilityDock";
import {
  mapLegacyToolToDestination,
  mapMediaIntentToDestination,
  destinationToLegacyTool,
  resolveCreatorDestination,
  workspaceStageToMode,
  type StudioDestination,
  type StudioMode,
  type CreateMode,
  type MoreMode,
  type MissionMode,
  type InspectorTab,
  type WorkspaceStage,
  type StudioTool,
} from "../lib/studio-destinations";
import {
  FIRST_INSPECTION_PROMPT,
  deriveFirstMissionLaunchpadState,
  type FirstMissionActionId,
  type FirstMissionLaunchpadState,
} from "../lib/first-mission-launchpad";
import { describeSourceRows } from "../lib/source-rows";

/* ── Legacy tool components (loaded through adapters) ──────────── */
// ChatTool is NOT mounted here — the conversation controller
// (useStudioConversation) + StudioTranscript + CommandComposer replace it.
const CanvasPanel = dynamic(() => import("./canvas/CanvasPanel").then((m) => m.CanvasPanel), { ssr: false });
const VisualCanvasBuilder = dynamic(() => import("./canvas/builder/VisualCanvasBuilder").then((m) => m.VisualCanvasBuilder), { ssr: false });
const CodeWorkspace = dynamic(() => import("./code/CodeWorkspace").then((m) => m.CodeWorkspace), { ssr: false });
const StudioPlanSurface = dynamic(() => import("./StudioPlanSurface"), { ssr: false });
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

// Which surface renders inside Studio/Work. Canonical identity lives in
// studio-destinations.ts: (studio, work, builder) ⟷ ?tool=build.
type WorkSurface = import("../lib/studio-destinations").WorkSurface;

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
    <LiTTRuntimeProvider>
      <VoiceSessionProvider>
        <CommandStudioContent />
      </VoiceSessionProvider>
    </LiTTRuntimeProvider>
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
  const {
    capabilities,
    refresh: refreshCapabilities,
    loading: capabilitiesLoading,
    runtime,
  } = useConnectionSummary();
  const runtimeState = runtime?.state ?? INITIAL_RUNTIME_STATE;
  // Socket status-feed freshness for the pre-send hint. useLiTTRuntime is a
  // refCounted singleton socket (LiTTLiveActivity already holds one), so this
  // opens no new connection.
  const { freshness: runtimeFeedFreshness } = useLiTTRuntime();
  const executionHint = useMemo(
    () => deriveExecutionHint(runtimeFeedFreshness, runtimeState),
    [runtimeFeedFreshness, runtimeState],
  );
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);
  const executionMode = useStudioAgentStore((s) => s.executionMode);
  const setExecutionMode = useStudioAgentStore((s) => s.setExecutionMode);
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  // Look up health by provider first, then fall back to apiProvider
  // (e.g. "Auto" models route to "gemini" under the hood).
  const modelHealth = providerHealth[selectedModel.provider] ?? providerHealth[selectedModel.apiProvider ?? ""];
  const modelLabel = selectedModel.label;
  // Resolve initial destination from legacy ?tool= query.
  // There is no user-facing mode choice: the router always behaves as
  // auto, so ?mode= (if present) is ignored.
  // An explicit ?creator= deep-link (e.g. /studio?creator=image from the
  // Create hub) is authoritative and wins over ?tool=.
  const initial = useMemo(() => {
    const creatorDest = resolveCreatorDestination(searchParams.get("creator"));
    if (creatorDest) return creatorDest;
    const fromUrl = searchParams.get("tool");
    if (fromUrl === "pipeline") {
      return mapLegacyToolToDestination("workflows");
    }
    return mapLegacyToolToDestination(fromUrl, searchParams.get("mission") ?? undefined);
  }, [searchParams]);

  const [destination, setDestination] = useState<StudioDestination>(initial.destination);
  // `initial.mode` is only meaningful for the destination it was resolved
  // for — e.g. a default `tool=chat` mount resolves to (studio, "preview").
  // Casting that same "preview" value into CreateMode/MoreMode/MissionMode
  // for destinations the URL never asked for produces bogus modes (e.g.
  // moreMode = "preview", which isn't a real MoreMode and has no
  // TOOL_COMPONENTS entry). That silently broke the mobile bottom nav's
  // "More" button on any mount that didn't already land on ?tool=plugins:
  // tapping it selected destination "more" but activeLegacyTool resolved
  // to the stale, invalid mode, so the workspace fell back to
  // StudioUnavailableSurface instead of PluginsTool. Only adopt
  // `initial.mode` when the initial destination actually matches.
  const [studioMode, setStudioMode] = useState<StudioMode>(
    initial.destination === "studio" ? (initial.mode as StudioMode) ?? "preview" : "preview",
  );
  const [createMode, setCreateMode] = useState<CreateMode>(
    initial.destination === "create" ? (initial.mode as CreateMode) ?? "image" : "image",
  );
  // Bumped only when a prompt-carrying image/video draft is written for an
  // intent. Creators consume drafts in a mount-only effect (VideoTool /
  // ImageTool), so a repeat intent while the creator is already mounted
  // needs a remount (via the WorkspaceComponent key) to read the new draft.
  // Promptless navigation never touches it — no gratuitous remounts.
  const [creatorDraftEpoch, setCreatorDraftEpoch] = useState(0);
  const [moreMode, setMoreMode] = useState<MoreMode>(
    initial.destination === "more" ? (initial.mode as MoreMode) ?? "plugins" : "plugins",
  );
  const [missionMode, setMissionMode] = useState<MissionMode>(
    initial.destination === "missions" ? (initial.mode as MissionMode) ?? "overview" : "overview",
  );
  const [, setPendingCommand] = useState<string>(initial.command ?? "");
  const [composerValue, setComposerValue] = useState("");
  /**
   * P1-1: prompt prefilled into the Image Studio when the chat image
   * intent fires ("generate an image of X" → the real ImageTool opens
   * with this prompt). Cleared whenever we leave the create destination
   * so a stale prompt never prefills a later visit.
   */
  const [imageStudioPrompt, setImageStudioPrompt] = useState<string | null>(null);
  const [videoStudioPrompt, setVideoStudioPrompt] = useState<string | null>(null);
  // Canvas-first 2-zone layout: the live preview is the Preview workspace
  // tab's StudioPreviewPanel, consuming the full workspace width. Studio
  // never reserves canvas width for a second preview column.
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const studioSelection: StudioSelection | null = previewSelection
    ? { elementId: previewSelection.selector, componentName: previewSelection.tagName, content: previewSelection.label }
    : null;
  const [completion, setCompletion] = useState<{ changes: MutationSummary; previewUpdated: boolean; repaired: boolean } | null>(null);

  // Safety: clear any stuck body styles from resize handles that didn't
  // clean up properly. This is the #1 cause of "can't type in text fields"
  // bugs — a drag handler sets userSelect="none" on body and never clears it.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.body.style.userSelect === "none") {
      document.body.style.userSelect = "";
    }
    if (document.body.style.cursor && document.body.style.cursor !== "") {
      document.body.style.cursor = "";
    }
  }, []);
  // Dynamic Work surface — not derived from initial.legacyTool after init.
  const [workSurface, setWorkSurface] = useState<WorkSurface>(
    initial.legacyTool === "build" ? "builder" : "conversation",
  );

  // ── Phase D.1: independent workspace stage ───────────────────────
  // The canonical workspaceMode (Plan/Canvas/Code/Preview) is INDEPENDENT
  // from creator. When a creator is activated (destination → "create"),
  // we preserve the last workspace stage so the context can represent
  // e.g. { workspaceMode: "code", creator: "image" }.
  const [lastWorkspaceStage, setLastWorkspaceStage] = useState<WorkspaceStage>(
    deriveWorkspaceStage(initial.destination, (initial.mode as StudioMode) ?? "preview") ?? "preview",
  );

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(initial.openInspector ?? "plan");

  // ── Studio dock state (P2/P3) ────────────────────────────────────
  // The single bottom dock replaces the old left ContextDrawer (desktop),
  // the bottom StudioDrawer, and the inspector hosting. Open state, active
  // tab, and height persist in sessionStorage; the dock itself mirrors the
  // same keys so a tab-click on the collapsed strip survives async parent
  // updates. Initial URL openDrawer maps onto the dock.
  const [dockOpen, setDockOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return !!initial.openDrawer;
    try {
      const stored = sessionStorage.getItem("studio-dock-open");
      if (stored !== null) return stored === "true";
    } catch { /* noop */ }
    return !!initial.openDrawer;
  });
  const [dockTab, setDockTab] = useState<StudioDockTab>(() => {
    const t = initial.openDrawer;
    return t === "activity" || t === "terminal" || t === "media" ? t : "activity";
  });
  const [dockHeight, setDockHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 320;
    try {
      const stored = Number(sessionStorage.getItem("studio-dock-height"));
      if (Number.isFinite(stored) && stored > 0) return stored;
    } catch { /* noop */ }
    return 320;
  });
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const approvalPhase = useExecutionStore((s) => s.approvalPhase);
  const approvalError = useExecutionStore((s) => s.approvalError);
  const approvalRetryable = useExecutionStore((s) => s.approvalRetryable);
  const approvalExpired = useExecutionStore((s) => s.approvalExpired);

  const handleToggleDock = useCallback(() => setDockOpen((v) => !v), []);
  const handleOpenDockTab = useCallback((tab: StudioDockTab) => {
    setDockTab(tab);
    setDockOpen(true);
  }, []);

  // The query string written by the state→URL effect on its last pass —
  // used by URL→state to recognize (and skip) our own echoes.
  const lastWrittenUrlRef = useRef<string | null>(null);

  // ── URL → State synchronization (browser back/forward) ───────────
  // When the URL changes (back/forward navigation), update React state
  // to match. Only updates when the canonical value actually changed,
  // preventing update loops with the state→URL effect below.
  useEffect(() => {
    // Echo guard: if this exact URL was written by the state→URL effect
    // below, it reflects state we already have — applying it back would
    // create a one-tick-lagged feedback oscillator (state ↔ URL each
    // correcting the other toward a stale view, forever).
    const navKey = searchParams.toString();
    if (navKey === lastWrittenUrlRef.current) {
      lastWrittenUrlRef.current = null;
      return;
    }
    // An explicit ?creator= deep-link (e.g. /studio?creator=image from the
    // Create hub, or the chat image intent's surface) is an authoritative
    // surface change — it wins over ?tool= and over the param-only guard
    // below (a creator URL legitimately carries no ?tool=).
    const creatorDest = resolveCreatorDestination(searchParams.get("creator"));
    if (creatorDest) {
      setDestination((cur) => (cur === "create" ? cur : "create"));
      const newMode = (creatorDest.mode as CreateMode) ?? "image";
      setCreateMode((cur) => (cur === newMode ? cur : newMode));
      return;
    }
    const fromUrl = searchParams.get("tool");
    // A param-carrying URL with no `tool` makes no surface assertion —
    // it is a param-only write (project / conversation / agent / mission
    // churn from other writers, or a partial shared link). Mapping it
    // through the default case would force (studio, preview, conversation)
    // and eject Builder — or bounce any active stage — for no reason.
    // Only an explicit `tool` value is an authoritative surface change.
    // ?mode= is ignored: there is no user-facing mode choice.
    // A fully bare /studio still means "default Studio surface".
    if (fromUrl === null && navKey !== "") {
      return;
    }
    const mapped = mapLegacyToolToDestination(
      fromUrl === "pipeline" ? "workflows" : fromUrl,
      searchParams.get("mission") ?? undefined,
    );

    setDestination((cur) => (cur === mapped.destination ? cur : mapped.destination));
    if (mapped.destination === "studio") {
      const newMode = (mapped.mode as StudioMode) ?? "preview";
      setStudioMode((cur) => (cur === newMode ? cur : newMode));
      // workSurface is part of the canonical Builder identity —
      // ?tool=build restores it; drawer-overlay routes (e.g. terminal)
      // preserve the active surface — same rule as handleRouteTool;
      // any other explicit Studio tool exits it.
      if (mapped.legacyTool === "build") setWorkSurface("builder");
      else if (!mapped.openDrawer) setWorkSurface("conversation");
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

  // ── Phase D.1: track the last workspace stage when in Studio ──────
  // When the user is in the Studio destination (Plan/Canvas/Code/Preview),
  // record the stage so it persists when a creator is activated.
  useEffect(() => {
    if (destination === "studio") {
      const stage = deriveWorkspaceStage(destination, studioMode);
      if (stage) setLastWorkspaceStage(stage);
    }
  }, [destination, studioMode]);

  // Phase C2.2: the old "unified side panel manager" (StudioSidePanel /
  // littree:studio:side-panel / littree:studio:activity-rail-open) has
  // been removed. It stopped driving any rendered UI once the LiTT
  // panel and Context Drawer became the canonical shell state in C2/
  // C2.1 — it was a ghost state machine that some call sites still
  // wrote to, silently doing nothing. Those call sites now use the
  // real Context Drawer / LiTT state directly (see
  // handleOpenContextInspector, littCollapsed, littActiveTab below).

  // LiTT panel — always present on desktop/laptop, expand/collapse.
  // Phase C2: moved from right to left. Phase C2.1: viewport-tier aware
  // (desktop/laptop rail vs mobile overlay sheet), single canonical tab
  // state, and a laptop first-run default (collapsed) that never
  // overrides an explicit stored user preference.
  const LITT_COLLAPSED_KEY = "littree:studio:litt-collapsed";

  const [littCollapsed, setLittCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(LITT_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LITT_COLLAPSED_KEY, String(littCollapsed));
    } catch {
      // ignore
    }
  }, [littCollapsed]);

  // Canonical LiTT active tab — single source of truth shared by the
  // desktop rail, the mobile sheet, and header/activity actions.
  const [littActiveTab, setLittActiveTab] = useState<"chat" | "live">("chat");

  // Viewport tier drives desktop-rail vs mobile-sheet LiTT presentation.
  // null until the first client measurement (SSR-safe — see hook docs).
  const viewportTier = useViewportTier();
  const isMobileLitt = viewportTier === "mobile";
  const [mobileLittOpen, setMobileLittOpen] = useState(false);
  // Mobile density redesign: progressive-disclosure sheet state. Both sheets
  // render only while the mobile chat sheet is open (see mounts below).
  const [mobileBuildOpen, setMobileBuildOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  // Mobile density redesign: opening a tool from the Tools sheet closes both
  // sheets so the chosen tool becomes the one dominant surface (this also
  // fixes the old behavior where tool buttons switched the workspace
  // invisibly behind the open chat sheet).
  const openMobileTool = (fn: () => void) => () => {
    fn();
    setMobileToolsOpen(false);
    setMobileLittOpen(false);
  };

  // LiTT panel defaults to EXPANDED on all desktop tiers (laptop + desktop).
  // The chat is the primary left surface — users should see it immediately,
  // not a 64px collapsed strip. They can manually collapse via the panel
  // button and that preference is persisted via the localStorage effect above.
  const laptopDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (laptopDefaultAppliedRef.current) return;
    if (viewportTier === null) return;
    laptopDefaultAppliedRef.current = true;
    // No auto-collapse — expanded by default on all desktop tiers.
  }, [viewportTier]);

  // Resizable pane widths — persisted to localStorage, clamped to min/max.
  // LiTT chat is the PRIMARY surface — wide default (520px) so the
  // conversation has room to breathe. Range 420–640px.
  const littResize = useResizableWidth({
    storageKey: "littree:studio:litt-width",
    defaultWidth: 520,
    minWidth: 420,
    maxWidth: 640,
    direction: "left",
  });
  // Context Drawer: 280–480px open, 0px closed (closed handled by `open` prop).
  // Phase 1: repositioned left-of-center, narrower default (~210px) to act
  // as the contextual secondary panel beside the nav rail.
  const contextResize = useResizableWidth({
    storageKey: "littree:studio:context-width",
    defaultWidth: 210,
    minWidth: 180,
    maxWidth: 320,
    direction: "right",
  });
  // Context Drawer — left-of-center contextual panel (Phase 1 reorientation).
  // Default CLOSED; users open it via the Files/Inspector/Work workspace tabs.
  // The choice persists across reloads.
  const CONTEXT_OPEN_KEY = "littree:studio:context-open";
  const CONTEXT_TAB_KEY = "littree:studio:context-tab";
  const [contextDrawerOpen, setContextDrawerOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(CONTEXT_OPEN_KEY);
      // Default to closed (false) unless explicitly opened before.
      return stored === "true";
    } catch {
      return false;
    }
  });
  const [contextDrawerTab, setContextDrawerTab] = useState<ContextDrawerTab>(() => {
    if (typeof window === "undefined") return "work";
    try {
      const stored = localStorage.getItem(CONTEXT_TAB_KEY);
      if (stored === "work" || stored === "files" || stored === "inspector" || stored === "assets") return stored;
      return "work";
    } catch {
      return "work";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CONTEXT_OPEN_KEY, String(contextDrawerOpen));
    } catch {
      // ignore
    }
  }, [contextDrawerOpen]);
  useEffect(() => {
    try {
      localStorage.setItem(CONTEXT_TAB_KEY, contextDrawerTab);
    } catch {
      // ignore
    }
  }, [contextDrawerTab]);

  // Derived booleans for downstream components (must be after state declarations)
  // Activity is an OPEN action. It always opens the bottom dock on the
  // Activity tab, where execution telemetry (tool calls, diffs, checks,
  // approvals) now lives. It never merely flips panel state.
  const handleOpenActivity = useCallback(() => {
    handleOpenDockTab("activity");
  }, [handleOpenDockTab]);

  // Listen for "Ask LiTT" events from Canvas and other surfaces.
  // Expands the canonical left LiTT, switches to Chat, and optionally
  // pre-fills the composer with context from the requesting surface.
  // This replaces the duplicate LiTTCopilotPanel that used to live inside
  // the Canvas Properties panel (one LiTT, not two).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { context?: string; prompt?: string } | undefined;
      if (isMobileLitt) {
        setMobileLittOpen(true);
      } else {
        setLittCollapsed(false);
      }
      setLittActiveTab("chat");
      if (detail?.prompt) {
        setComposerValue(detail.prompt);
      }
    };
    window.addEventListener("studio:ask-litt", handler);
    return () => window.removeEventListener("studio:ask-litt", handler);
  }, [isMobileLitt]);

  // Canvas ActionPanel events — the studio.* ArtifactActions execute
  // client-side: executeAction dispatches these DOM events and the owning
  // surfaces react. Deploy routes through the existing ask-litt path
  // (pre-fill the composer, user confirms before the agent run starts);
  // the deploy itself still goes through the ApprovalCard gate.
  useEffect(() => {
    const openDock = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab as StudioDockTab | undefined;
      if (tab === "activity" || tab === "files" || tab === "terminal" || tab === "inspector" || tab === "media") {
        handleOpenDockTab(tab);
      }
    };
    const requestDeploy = () => {
      window.dispatchEvent(
        new CustomEvent("studio:ask-litt", {
          detail: { prompt: "Deploy this project to production" },
        }),
      );
    };
    // Open a file from the ActionPanel's file tree: switch to the dock
    // Files tab. The StudioProjectFiles instances listen for the same
    // event and select the file themselves when the project matches.
    const openFile = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId?: string; path?: string } | undefined;
      if (typeof detail?.path !== "string" || detail.path.length === 0) return;
      handleOpenDockTab("files");
    };
    window.addEventListener(STUDIO_EVENT_OPEN_DOCK, openDock);
    window.addEventListener(STUDIO_EVENT_REQUEST_DEPLOY, requestDeploy);
    window.addEventListener(STUDIO_EVENT_OPEN_FILE, openFile);
    return () => {
      window.removeEventListener(STUDIO_EVENT_OPEN_DOCK, openDock);
      window.removeEventListener(STUDIO_EVENT_REQUEST_DEPLOY, requestDeploy);
      window.removeEventListener(STUDIO_EVENT_OPEN_FILE, openFile);
    };
  }, [handleOpenDockTab]);

  // Dock open helpers — both are OPEN actions (switch tab + ensure
  // open), never a toggle-closed. The dock's own close button and the
  // header dock toggle close it. Files, Inspector, and Terminal live in
  // the dock; the permanent left ContextDrawer is gone on desktop.
  // Opening/closing the dock must not change the active surface.
  const handleOpenContextFiles = useCallback(() => {
    handleOpenDockTab("files");
  }, [handleOpenDockTab]);
  const handleOpenContextInspector = useCallback(() => {
    handleOpenDockTab("inspector");
  }, [handleOpenDockTab]);

  // Keyboard shortcuts: Ctrl+Shift+A opens the dock Activity tab;
  // Cmd/Ctrl+J toggles the dock.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        handleOpenActivity();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j" && !typing) {
        // Don't hijack when xterm has focus — the terminal owns its keys.
        if (document.activeElement?.closest(".xterm")) return;
        event.preventDefault();
        handleToggleDock();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenActivity, handleToggleDock]);

  const [cameraDock, setCameraDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "top-right" });
  const [cameraStatus, setCameraStatus] = useState<string>("idle");
  const [screenDock, setScreenDock] = useState<{ open: boolean; pos: DockPosition }>({ open: false, pos: "bottom-left" });
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [pendingCanvasAction, setPendingCanvasAction] = useState<ArtifactAction | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [healthRunTrigger, setHealthRunTrigger] = useState(0);

  // Files panel state is now managed by the Context Drawer (Phase C2).
  // The old filesPanelOpen state has been replaced by contextDrawerOpen + contextDrawerTab.

  const handleSelectDestination = useCallback((dest: StudioDestination) => {
    setDestination(dest);
  }, []);

  // New-project dialog state lives up here (not with the other project
  // creation logic below) because the conversation controller references
  // openProjectNameDialog and must be declared after it — same TDZ rule
  // as handleRouteTool.
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null);
  const [projectNameDialogOpen, setProjectNameDialogOpen] = useState(false);

  const openProjectNameDialog = useCallback(() => {
    setProjectCreateError(null);
    setProjectNameDialogOpen(true);
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
    const mapped = ["image", "video", "audio", "music"].includes(tool)
      ? mapMediaIntentToDestination(tool as "image" | "video" | "audio" | "music")
      : mapLegacyToolToDestination(tool, command);
    setDestination(mapped.destination);
    if (mapped.destination === "studio") {
      setStudioMode((mapped.mode as StudioMode) ?? "work");
      // Explicit Build route → builder surface. Routes that only open a
      // drawer overlay (e.g. terminal) preserve the active surface —
      // everything else returns to the conversation.
      if (tool === "build") setWorkSurface("builder");
      else if (!mapped.openDrawer) setWorkSurface("conversation");
    }
    if (mapped.destination === "create") {
      setCreateMode((mapped.mode as CreateMode) ?? "image");
      if (command.trim() && (tool === "image" || tool === "video")) {
        try {
          sessionStorage.setItem(`litlabs:${tool}:draft`, JSON.stringify({ prompt: command.trim() }));
          // Remount the already-active creator so its mount-only draft
          // effect picks up the new prompt. No-op when it mounts fresh.
          setCreatorDraftEpoch((n) => n + 1);
        } catch {
          // Draft handoff is best-effort; the creator remains usable if storage is unavailable.
        }
      }
    }
    if (mapped.destination === "missions") setMissionMode((mapped.mode as MissionMode) ?? "overview");
    if (mapped.destination === "more") setMoreMode((mapped.mode as MoreMode) ?? "plugins");
    if (mapped.openDrawer) {
      const terminalNeedsExplicitConnect =
        mapped.openDrawer === "terminal" && capabilities.terminalStatus !== "connected" && !command;
      if (!terminalNeedsExplicitConnect) {
        setDockTab(mapped.openDrawer as StudioDockTab);
        setDockOpen(true);
      }
    }
    if (mapped.openInspector) {
      handleOpenContextInspector();
      setInspectorTab(mapped.openInspector);
    }
    setPendingCommand(command);
  }, [capabilities.terminalStatus, handleOpenContextInspector]);

  // P1-1: the chat image intent ("generate an image of X") opens the REAL
  // Image Studio — the create destination's ImageTool — with the user's
  // prompt prefilled. This is what "Opening the image generator." promises.
  // Deliberately separate from handleRouteTool: the legacy "image" tool id
  // normalizes to the chat surface, not the creator.
  const handleOpenImageStudio = useCallback((prompt: string) => {
    setImageStudioPrompt(prompt || null);
    setCreateMode("image");
    setDestination("create");
  }, []);

  const handleOpenVideoStudio = useCallback((prompt: string) => {
    setVideoStudioPrompt(prompt || null);
    setCreateMode("video");
    setDestination("create");
  }, []);

  // A prefilled image prompt only lives while the create destination is
  // active — leaving clears it so a later Image Studio visit starts clean.
  useEffect(() => {
    if (destination !== "create") {
      setImageStudioPrompt(null);
      setVideoStudioPrompt(null);
    }
  }, [destination]);

  // The single conversation controller — calls canonical V12 API.
  const conversation = useCanonicalConversation({
    onRouteToolAction: handleRouteTool,
    onRouteInspectorAction: (tab) => {
      setInspectorTab(tab);
      handleOpenContextInspector();
    },
    onRunHealthChecks: () => {
      // Open the checks panel and trigger run-all
      setInspectorTab("checks");
      handleOpenContextInspector();
      setHealthRunTrigger((n) => n + 1);
    },
    onOpenProjectNameDialog: openProjectNameDialog,
    onOpenImageStudio: handleOpenImageStudio,
    onOpenVideoStudio: handleOpenVideoStudio,
    // The URL's explicit ?project= is authoritative the instant it's present —
    // capabilities.projectId is resolved by an async fetch that can still be
    // in flight (or, if it started before the URL param was readable, can
    // resolve to the wrong project via resolveCurrentProject's "most
    // recently updated project" fallback). Racing a brand-new conversation
    // create against that fallback attaches it to a stale, unrelated
    // project, which then desyncs the single (non-per-conversation)
    // revision counter and surfaces as a spurious "stale revision" 409 on
    // the very first message. The explicit URL project always wins here;
    // capabilities.projectId is only used when no project is named in the URL.
    serverProjectId: searchParams.get("project") ?? capabilities.projectId,
    cameraState: { active: cameraDock.open, status: cameraStatus },
    previewSelection,
    // Shared capabilities — the hook must not start a second poll stack.
    capabilities,
  });

  const launchpadState = useMemo(
    () => deriveFirstMissionLaunchpadState({
      runtime: runtimeState,
      runtimeLoading: runtime ? runtime.loading || capabilitiesLoading : true,
      runtimeError: runtime?.error,
      providerHealth: capabilitiesLoading ? undefined : modelHealth,
      inspection: conversation.busy ? {
        status: "running" as const,
        toolResults: [],
        persistedAssistantResponse: false,
      } : undefined,
    }),
    [runtimeState, runtime, capabilitiesLoading, modelHealth, conversation.busy],
  );

  // ── LiTT Live realtime session ──
  const liveSession = useLiTTRealtimeSession();

  // Sync destination -> URL ?tool= (canonical: tool=chat).
  // The canonical route is always ?tool=chat — LiTT routes the work
  // itself (auto). Workspace stages (code, canvas, preview) get their
  // own ?tool= value for deep-linking. Any stray ?mode= is dropped:
  // there is no user-facing mode choice.
  useEffect(() => {
    const activeMode =
      destination === "studio" ? studioMode :
      destination === "create" ? createMode :
      destination === "more" ? moreMode :
      undefined;
    const legacyTool = destinationToLegacyTool(destination, activeMode, workSurface);
    try {
      localStorage.setItem("littree:studio:tool", legacyTool);
    } catch {
      // ignore
    }
    // Build the target URL with ?tool=
    const params = new URLSearchParams(searchParams.toString());

  // Canonical: always tool=chat for the LiTT conversation surface.
    // Workspace stages (code/canvas/preview) get their own tool value.
    // The create destination (Image Studio et al) is deep-linkable via
    // ?creator=<mode> — the ONLY URL route into the creator surfaces.
    // Writing ?tool=image here would NOT round-trip: legacy creative
    // tool URLs normalize to the chat surface on load by design.
    if (destination === "create") {
      params.delete("tool");
      params.set("creator", createMode);
    } else {
      params.set("tool", legacyTool);
      params.delete("creator");
    }
    // Drop any ?mode=: the router always behaves as auto, and mode is
    // never a user-facing choice. Also preserve agent and conversation params.
    params.delete("mode");
    // Preserve agent param if present
    const agent = searchParams.get("agent");
    if (agent) params.set("agent", agent);
    const target = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    if (target !== current) {
      // Mark the URL we are about to write so the URL→state effect can
      // recognize the echo and not re-apply it as a navigation.
      lastWrittenUrlRef.current = params.toString();
      router.replace(target, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, studioMode, createMode, moreMode, workSurface, pathname, router]);

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

  // Auto-reveal the dock Activity tab when LiTT starts executing,
  // without stealing focus. This does NOT call .focus() on any
  // element — the user's current focus (e.g., the composer) is preserved.
  const prevBusyRef = useRef(false);
  useEffect(() => {
    const isBusy = conversation.busy || creatingProject;
    if (isBusy && !prevBusyRef.current) {
      handleOpenDockTab("activity");
    }
    prevBusyRef.current = isBusy;
  }, [conversation.busy, creatingProject, handleOpenDockTab]);

  // ── Auto-switch workspace to Media when LiTT generates an artifact ──
  // When a new assistant message contains an image/video/music artifact,
  // automatically switch the workspace to the Media tab so the user can
  // see the result. This is invariant 10: generated artifacts automatically
  // open the correct workspace surface.
  const prevMessageCountRef = useRef(conversation.messages.length);
  useEffect(() => {
    const newCount = conversation.messages.length;
    if (newCount <= prevMessageCountRef.current) {
      prevMessageCountRef.current = newCount;
      return;
    }
    // Check the newest messages for artifact indicators
    const newMessages = conversation.messages.slice(prevMessageCountRef.current);
    prevMessageCountRef.current = newCount;
    const hasImageArtifact = newMessages.some((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("data:image") || content.includes("/api/media/") ||
             content.includes("![") || content.includes('"type":"image"');
    });
    const hasVideoArtifact = newMessages.some((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("/api/media/") && content.includes("video") ||
             content.includes('"type":"video"');
    });
    const hasMusicArtifact = newMessages.some((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("/api/music/") || content.includes('"type":"audio"') ||
             content.includes('"type":"music"');
    });
    if (hasImageArtifact || hasVideoArtifact || hasMusicArtifact) {
      setDestination("studio");
      setStudioMode("media" as StudioMode);
    }
  }, [conversation.messages]);

  const handleComposerSend = useCallback(async (value: string, attachments?: string[]) => {
    // The canonical controller provisions a starter project and conversation
    // when needed. Do not block first-time users at the composer boundary.
    if (isMobileLitt) {
      mobileDiag("composer", "send_attempt", {
        hasProject: !!capabilities.projectId,
        attachmentCount: attachments?.length ?? 0,
      });
    }
    try {
      const result = await conversation.send(value, attachments);
      if (isMobileLitt) {
        // errorKind is already a small, non-content-bearing enum
        // ("auth" | "network" | "conflict" | "provider" | "validation") —
        // safe to log verbatim.
        mobileDiag(
          result?.errorKind === "auth" ? "auth" : "chat_api",
          result?.accepted ? "send_accepted" : "send_rejected",
          { errorKind: result?.errorKind ?? null, persisted: !!result?.persisted },
        );
      }
      if (result?.accepted) {
        const execution = useExecutionStore.getState();
        const changes = execution.changesSummary ?? { added: 0, modified: 0, deleted: 0, renamed: 0 };
        const filesChanged = changes.added + changes.modified + changes.deleted + changes.renamed;
        const repaired = execution.events.some((event) => event.type === "repair_attempt");
        // The launch flow can start/refresh the workspace preview without any
        // file writes (e.g. template preview, or model failure after preview
        // start). Re-poll preview status in that case so the iframe appears.
        const previewReady = execution.events.some((event) => event.type === "preview" && event.success);
        // Also refresh if any tool execution events fired (the agent may have
        // written files but the changesSummary wasn't populated — the SSE
        // stream may have ended before the done event carried the summary).
        const hadToolExecution = execution.events.some(
          (event) => event.type === "tool_start" || event.type === "tool_result",
        );
        if ((filesChanged > 0 || previewReady || hadToolExecution) && capabilities.projectId) {
          setWorkspaceRevision((revision) => revision + 1);
          window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId: capabilities.projectId, source: "assistant" } }));
        }
        if (result.pendingApproval) {
          // The run paused at an approval gate — it is NOT done. Surface
          // the Live tab (where the Approve/Reject control lives) instead
          // of showing a false "Done · No files changed" completion card.
          setLittActiveTab("live");
          if (isMobileLitt) {
            setMobileLittOpen(true);
          } else {
            setLittCollapsed(false);
          }
        } else if (result.awaitingInput) {
          // A clarifying question is a paused turn, not completed work.
          // Keep the mission truthful and avoid the false completion card.
          execution.setPhase("awaiting_input");
          setLittActiveTab("chat");
        } else if (result.suppressCompletion) {
          // P1-1: the image intent opened the Image Studio surface — this
          // send was not an agent run, so no completion card. Rendering
          // "Done · No files changed" here would fake a generation success.
          setLittActiveTab("chat");
        } else {
          setCompletion({ changes, previewUpdated: previewReady, repaired });
          setContextDrawerOpen(false);
          setLittActiveTab("chat");
        }
        if (!capabilities.projectId) {
          await refreshCapabilities();
        }
      }
      return result;
    } catch (err) {
      // Restore the typed message so the user doesn't lose input, and
      // surface the error so the user knows why their message didn't send.
      setComposerValue(value);
      console.error("[Studio] Composer send failed:", err);
      if (isMobileLitt) {
        mobileDiag("chat_api", "send_threw", {
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }
      return { accepted: false, persisted: false, errorKind: "network" as const };
    }
  }, [conversation, capabilities.projectId, refreshCapabilities, isMobileLitt]);

  // Approval decisions resume the SAME paused server-side execution — never
  // a new run. The approval lifecycle only settles when the resumed run
  // reaches a terminal state: the card stays mounted through submitting
  // and executing, and a non-2xx POST or a failed run keeps the card
  // visible with the backend error and a Retry affordance (re-POSTs the
  // same pausedRunId; the server re-runs the same record). Nothing
  // silently clears, nothing auto re-requests.
  // Exception: a resumed run that pauses on a NEW gate stays on Live so the
  // fresh Approve/Reject card is visible.
  const applyApprovalOutcome = useCallback((opts: {
    conversationId: string;
    resolution: "approved" | "rejected" | "expired" | "gone";
    runResult?: ApprovalRunResult | null;
    runError?: string | null;
    retryable?: boolean;
    expired?: boolean;
  }) => {
    const exec = useExecutionStore.getState();
    if (opts.resolution === "rejected") {
      if (opts.runError) {
        // The rejection POST itself failed — keep the card with the error
        // and a retry affordance instead of clearing a decision that never
        // landed server-side.
        exec.failApproval(opts.runError, opts.retryable);
        return;
      }
      exec.resolveApproval("rejected");
      // The resumed run's outcome was written back onto the conversation
      // transcript server-side — pull it instead of fabricating anything.
      void conversation.loadMessages(opts.conversationId);
      setLittActiveTab("chat");
      return;
    }
    if (opts.resolution === "expired" || opts.resolution === "gone") {
      // The gate can no longer be actioned — but the run is not dead. Keep
      // the card mounted in the failed state with a "Request again"
      // affordance: one tap re-issues the SAME gate with a fresh TTL via
      // the re-request endpoint, instead of re-running the whole agent
      // loop from scratch. No decision is logged — the user never made one.
      exec.failApproval(
        "This approval expired before a decision was made.",
        true,
        { expired: true },
      );
      return;
    }
    // resolution === "approved"
    if (opts.runError) {
      // The run failed AFTER approval — keep the card mounted with the
      // backend error and a Retry affordance. The user re-approves the
      // same record; the resumed execution replays instead of double-running.
      // (An expiry failure keeps the card too, but retry re-requests a
      // fresh gate instead of re-POSTing the dead pausedRunId.)
      exec.failApproval(opts.runError, opts.retryable, { expired: opts.expired });
      void conversation.loadMessages(opts.conversationId);
      return;
    }
    // Idempotent on the click path — pendingApproval is already null, so
    // this clears state without logging a duplicate decision event.
    exec.resolveApproval("approved");
    // The resumed run's outcome was written back onto the conversation
    // transcript server-side — pull it instead of fabricating anything.
    void conversation.loadMessages(opts.conversationId);
    // The resumed run may have mutated workspace files — refresh the file
    // tree and preview like a normal completed send would.
    if (opts.runResult?.toolCalls.some((c) => c.mutating && c.success)) {
      setWorkspaceRevision((revision) => revision + 1);
      if (capabilities.projectId) {
        window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId: capabilities.projectId, source: "assistant" } }));
      }
    }
    if (opts.runResult?.pendingApproval?.pausedRunId) {
      exec.setPendingApproval({
        toolId: opts.runResult.pendingApproval.toolId,
        reason: opts.runResult.pendingApproval.reason,
        pausedRunId: opts.runResult.pendingApproval.pausedRunId,
        conversationId: conversation.selectedConversationId ?? undefined,
      });
      return;
    }
    setLittActiveTab("chat");
  }, [conversation, capabilities.projectId]);

  // Approval decisions resume the SAME paused server-side execution — never
  // a new run. When no pausedRunId exists (persistence failed or the paused
  // run expired), silently dropping the click would leave the user thinking
  // the work resumed while nothing ran — surface a truthful error instead.
  //
  // The card is NOT cleared on click: it stays mounted through submitting
  // and executing so a non-2xx POST or a failed run surfaces visibly with
  // a Retry affordance instead of silently clearing.
  const handleResolveApproval = useCallback((decision: "approved" | "rejected") => {
    const exec = useExecutionStore.getState();
    const pending = exec.pendingApproval;
    // The gate's OWN conversation wins: a pausedRunId posted to a different
    // conversation deterministic-403s ("Conversation mismatch") and used to
    // dead-end the card as unretryable. Falls back to the current selection
    // only for gates mounted before conversation binding existed.
    const convId = pending?.conversationId ?? conversation.selectedConversationId;
    if (pending?.pausedRunId && convId) {
      exec.beginApprovalSubmit();
      submitApprovalAndPoll({
        conversationId: convId,
        pausedRunId: pending.pausedRunId,
        decision,
        onAccepted: () => {
          // A rejection runs nothing server-side — settle immediately so the
          // user lands back on the composer instead of a dead Live tab.
          if (decision === "rejected") {
            applyApprovalOutcome({ conversationId: convId, resolution: "rejected" });
          } else {
            exec.approvalAccepted();
          }
        },
        onCompleted: (result) => {
          applyApprovalOutcome({ conversationId: convId, resolution: decision, runResult: result });
        },
        onFailed: (error, info) => {
          applyApprovalOutcome({
            conversationId: convId,
            resolution: decision,
            runError: error || "The resumed run failed on the server.",
            retryable: info?.retryable,
            expired: info?.expired,
          });
        },
      });
    } else {
      useExecutionStore.getState().resolveApproval(decision);
      // pending === null means the gate already settled — the detached
      // resumed run completed (the watcher pulled its outcome), the
      // decision was recorded on another session, or this click is a
      // duplicate of one already submitted. That is a stale card, not a
      // failed resume: converge quietly. The banner below stays honest —
      // it only fires when a gate is mounted but has no resume identity.
      if (pending && decision === "approved") {
        conversation.reportSendError?.(
          "This approval could not be resumed — the paused run expired or was not saved. Please resend your request.",
        );
      }
      setLittActiveTab("chat");
    }
  }, [conversation, capabilities.projectId, applyApprovalOutcome]);

  // Re-request an EXPIRED approval gate: one tap issues a fresh pending run
  // carrying the same frozen inputs/reason, with a new TTL — no new agent
  // loop, no duplicate side effects (nothing executes until approved).
  // Used when the card is in the failed-expired state; the card's Retry
  // button routes here instead of re-POSTing the dead pausedRunId.
  const handleReRequestApproval = useCallback(async () => {
    const exec = useExecutionStore.getState();
    const pending = exec.pendingApproval;
    // Same gate-bound conversation rule as handleResolveApproval — the
    // re-request must recreate the gate in its own conversation.
    const convId = pending?.conversationId ?? conversation.selectedConversationId;
    if (!pending?.pausedRunId || !convId) return;
    exec.beginApprovalSubmit();
    try {
      const token = await getToken?.();
      const res = await fetch(
        `/api/studio/conversations/${convId}/approvals/re-request`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ pausedRunId: pending.pausedRunId }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Re-request failed (${res.status})`);
      }
      if (!data.pausedRunId) {
        throw new Error("The server did not return a new approval gate.");
      }
      // Swap in the fresh gate — the card returns to pending and the
      // watcher re-arms on the new pausedRunId.
      exec.setPendingApproval({
        toolId: data.toolId ?? pending.toolId,
        reason: data.reason ?? pending.reason,
        pausedRunId: data.pausedRunId,
        inputs: pending.inputs,
        conversationId: pending.conversationId ?? conversation.selectedConversationId ?? undefined,
      });
    } catch (err) {
      exec.failApproval(
        err instanceof Error ? err.message : "Could not re-request the approval.",
        true,
        { expired: true },
      );
    }
  }, [conversation, getToken]);

  // An approval gate can settle without this client clicking anything:
  // approved/rejected on another device or session, a reload while the
  // resumed run was still executing (loadMessages rehydrates the gate), or
  // server-side TTL expiry. The card alone cannot converge in those cases —
  // watch the server-authoritative status and fold the outcome back into
  // the store + transcript, returning the user to Chat. The click path keeps
  // the card mounted through submitting/executing, so this watcher stays
  // armed alongside submitApprovalAndPoll's own polling — applyApprovalOutcome
  // is idempotent, so whichever path observes the terminal state first
  // settles and the other converges quietly.
  const applyApprovalOutcomeRef = useRef(applyApprovalOutcome);
  useEffect(() => {
    applyApprovalOutcomeRef.current = applyApprovalOutcome;
  });
  const watchPausedRunId = useExecutionStore((s) => s.pendingApproval?.pausedRunId ?? null);
  // Watch (and poll) against the gate's OWN conversation so a conversation
  // switch after the gate mounted cannot redirect the status GET either.
  const watchConversationId = useExecutionStore((s) => s.pendingApproval?.conversationId)
    ?? conversation.selectedConversationId;
  useEffect(() => {
    // Deps are only the gate identity — applyApprovalOutcome changes every
    // render (conversation identity is unstable), and re-arming on each
    // render would restart the poll loop per SSE event.
    if (!watchPausedRunId || !watchConversationId) return;
    return watchApprovalResolution({
      conversationId: watchConversationId,
      pausedRunId: watchPausedRunId,
      onSettled: (outcome) => {
        applyApprovalOutcomeRef.current({
          conversationId: watchConversationId,
          resolution: outcome.status,
          runResult: outcome.runResult,
          runError: outcome.runError
            ?? (outcome.runStatus === "failed" ? "The resumed run failed on the server." : null),
        });
      },
    });
  }, [watchPausedRunId, watchConversationId]);

  const handleStartBlank = useCallback(async (name: string) => {
    if (creatingProject) return;
    setCreatingProject(true);
    setProjectCreateError(null);
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
          name,
          templateId: "blank-static",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err as { error?: string }).error || `Failed to create project (${res.status})`;
        setProjectCreateError(msg);
        console.error("[handleStartBlank] Failed to create project:", err);
        if (isMobileLitt) mobileDiag("project", "create_failed", { status: res.status });
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
      window.dispatchEvent(new CustomEvent("studio:project-switching"));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      // Refresh capabilities so projectId propagates
      await refreshCapabilities();
      setDestination("studio");
      setStudioMode("work");
      setWorkSurface("conversation");
      setProjectNameDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error while creating project.";
      setProjectCreateError(msg);
      console.error("[handleStartBlank] Error:", err);
      if (isMobileLitt) mobileDiag("project", "create_threw", { errorName: err instanceof Error ? err.name : typeof err });
    } finally {
      setCreatingProject(false);
    }
  }, [creatingProject, searchParams, pathname, router, refreshCapabilities, userId, getToken, isMobileLitt]);

  const handlePrepareWorkspace = useCallback(async () => {
    if (!runtimeState.projectId) return;
    setCreatingProject(true);
    setProjectCreateError(null);
    try {
      const token = await getToken?.();
      const response = await fetch(
        `/api/studio-projects/${encodeURIComponent(runtimeState.projectId)}/workspace/prepare`,
        {
          method: "POST",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        workspaceStatus?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Workspace preparation failed (${response.status})`);
      }
      await Promise.all([refreshCapabilities(), runtime?.refresh() ?? Promise.resolve()]);
    } catch (error) {
      setProjectCreateError(error instanceof Error ? error.message : "Workspace preparation failed.");
      if (isMobileLitt) mobileDiag("project", "workspace_prepare_failed", { errorName: error instanceof Error ? error.name : typeof error });
    } finally {
      setCreatingProject(false);
    }
  }, [getToken, refreshCapabilities, runtime, runtimeState.projectId, isMobileLitt]);

  const handleSelectProject = useCallback((projectId: string) => {
    // Synchronous signal first — an in-flight send must see the switch
    // before router state settles.
    window.dispatchEvent(new CustomEvent("studio:project-switching"));
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", projectId);
    params.delete("conversation");
    params.delete("agentInstance");
    setWorkspaceRevision(0);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  /**
   * The project switcher only fires this after the server confirms the
   * deletion. When the deleted project was the active one, drop it from
   * the URL so the studio stops pointing at a project that no longer
   * exists — the capabilities refresh then settles to the no-project state.
   */
  const handleDeleteProject = useCallback((deletedProjectId: string) => {
    if (capabilities.projectId !== deletedProjectId) return;
    window.dispatchEvent(new CustomEvent("studio:project-switching"));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("project");
    params.delete("conversation");
    params.delete("agentInstance");
    setWorkspaceRevision(0);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    void refreshCapabilities();
  }, [capabilities.projectId, pathname, router, searchParams, refreshCapabilities]);

  // Header actions — truthful.
  const handlePreview = useCallback(() => {
    setDestination("studio");
    setStudioMode("preview");
  }, []);
  // Real deploy runs through LiTT in chat (project.deploy tool with
  // approval). This prefills the composer with a deploy request and opens
  // the chat surface — one tap, no developer tooling.
  const handleDeployRequest = useCallback(() => {
    window.dispatchEvent(new CustomEvent("studio:ask-litt", {
      detail: { prompt: "Deploy this project to a live public URL" },
    }));
  }, []);
  const handleOpenTerminal = useCallback(() => {
    // Terminal lives in the dock — a pure overlay action that must not
    // eject the active surface (e.g. Builder).
    handleOpenDockTab("terminal");
  }, [handleOpenDockTab]);

  const handleFirstMissionAction = useCallback((action: FirstMissionActionId) => {
    switch (action) {
      case "start_blank_project":
        openProjectNameDialog();
        break;
      case "prepare_workspace":
      case "retry_workspace":
        void handlePrepareWorkspace();
        break;
      case "configure_provider":
        router.push("/settings");
        break;
      case "connect_terminal":
        handleOpenTerminal();
        break;
      case "prepare_inspection":
        setExecutionMode("plan");
        setComposerValue(FIRST_INSPECTION_PROMPT);
        break;
    }
  }, [handleOpenTerminal, handlePrepareWorkspace, openProjectNameDialog, router, setExecutionMode]);

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

  const handleUndoCompletion = useCallback(async () => {
    await handleRollback();
    setCompletion(null);
    if (capabilities.projectId) {
      setWorkspaceRevision((revision) => revision + 1);
      window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId: capabilities.projectId, source: "rollback" } }));
    }
  }, [capabilities.projectId, handleRollback]);

  // Context line for the composer.
  const contextLine: ComposerContextLine = useMemo(() => ({
    workspace: capabilities.projectName ?? "Private LiTT workspace — created when you send",
    repo: capabilities.repositoryName ?? undefined,
    branch: capabilities.activeBranch ?? (typeof window !== "undefined" ? (searchParams.get("branch") ?? undefined) : undefined),
    permissionMode: capabilities.writeAccess ? "Writes allowed" : "Writes require approval",
    selectedElement: previewSelection?.label,
  }), [capabilities.activeBranch, capabilities.projectName, capabilities.repositoryName, capabilities.writeAccess, previewSelection?.label, searchParams]);

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
      if (studioMode === "design") return "design";
      if (studioMode === "preview") return "preview";
      if (studioMode === "media") return null; // Media has its own panel, no legacy tool
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
  const isPlan = destination === "studio" && studioMode === "work" && workSurface !== "builder";
  const isCanvas = destination === "studio" && studioMode === "files";
  const isCode = destination === "studio" && studioMode === "code";
  const isPreview = destination === "studio" && studioMode === "preview";
  const isMedia = destination === "studio" && studioMode === "media";
  // Canvas-first 2-zone layout: exactly one primary workspace surface at a
  // time. The live preview is the Preview workspace tab — never a second
  // column beside the workspace.

  // Primary workspace tabs. Plan and Media remain available through their
  // existing routes/drawers, but Design / Code / Preview are the only
  // persistent workspace modes competing for the main workspace.
  // These map through workspaceStageToMode() to legacy StudioMode internals.
  // Chat lives inside the LiTT left panel (Chat | Live tabs).
  // Files/Components live in the contextual right drawer.
  // Media shows generated images, video, music, and audio artifacts.
  const workspaceTabs: { id: WorkspaceStage; label: string }[] = [
    { id: "canvas", label: "Design" },
    { id: "code", label: "Code" },
    { id: "preview", label: "Preview" },
  ];

  // LiTT Chat/Live content — built ONCE per render and reused by whichever
  // single LiTT surface is actually mounted (desktop/laptop rail via
  // LiTTPanel, or the mobile overlay via LiTTMobileSheet). Exactly one of
  // those two ever renders at a time (gated by viewportTier), so there is
  // never a second CommandComposer / LiTTLiveActivity instance (Phase C2.1).
  // On mobile the sheet stays mounted and toggles via display:none so chat
  // state survives Chat <-> Canvas switching.
  // Shared MissionCards wiring — used by the desktop rail and by the mobile
  // Build status sheet (showActions={false}). One definition, no duplication.
  const missionCardsHandlers = {
    capabilities,
    modelLabel,
    onOpenCode: () => { setDestination("studio"); setStudioMode("code"); },
    onOpenCanvas: () => { setDestination("studio"); setStudioMode("files"); },
    onOpenPreview: handlePreview,
    onOpenTerminal: handleOpenTerminal,
    onOpenActivity: () => handleOpenDockTab("activity"),
    onOpenFiles: () => handleOpenDockTab("files"),
    onRollback: handleRollback,
  };

  const littChatContent = (
    <>
      {/* Mission cards — compact pinned intelligence above the chat.
          The Plan workspace tab's live summary, folded into collapsible
          cards: mission · checkpoints · next actions. All data comes from
          the same stores as the plan surface; no fabricated content.
          Mobile (<1024px): the card stack is replaced by the single
          MobileBuildStatusBar; the full cards live in the Build sheet. */}
      {isMobileLitt ? (
        <div className="shrink-0 px-3 pt-2">
          <MobileBuildStatusBar open={mobileBuildOpen} onOpen={() => setMobileBuildOpen(true)} />
        </div>
      ) : null}
      <StudioWorkSurface
        messages={conversation.messages}
        conversationId={conversation.selectedConversationId ?? null}
        busy={conversation.busy}
        loading={conversation.loading}
        activeAgentId={conversation.activeAgentId}
        fallbackNotice={conversation.fallbackNotice}
        onRouteToolAction={handleRouteTool}
        onRegenerateAction={conversation.regenerate}
        onSelectConversation={handleSelectConversation}
        launchpadState={launchpadState}
        displayName={profileDisplayName}
        onFirstMissionAction={handleFirstMissionAction}
        completion={completion}
        onDismissCompletion={() => setCompletion(null)}
        onUndoCompletion={handleUndoCompletion}
        overflowDownloads={isMobileLitt}
        onContinueCompletion={() => {
          const textarea = document.querySelector<HTMLTextAreaElement>("[data-testid='studio-command-composer'] textarea");
          textarea?.focus();
          setCompletion(null);
        }}
      />
      {(conversation.requiresReauth || conversation.sendError || projectCreateError) && (
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
              : conversation.sendError ?? projectCreateError}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {!conversation.requiresReauth && (conversation.sendError || projectCreateError) && (
              <button
                type="button"
                onClick={() => { conversation.clearSendError(); setProjectCreateError(null); }}
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
      {/* Approval gate — pinned directly above the composer so the
          approve/deny decision is always one glance away. Deploy
          approvals are visually distinct: project.deploy always
          requires a human, even in AUTO. */}
      {pendingApproval && (
        <div className="shrink-0 px-3 pt-2">
          <ApprovalCard
            approval={pendingApproval}
            onResolve={handleResolveApproval}
            isDeploy={pendingApproval.toolId === "project.deploy"}
            phase={approvalPhase}
            error={approvalError}
            retryable={approvalRetryable}
            expired={approvalExpired}
            // Mode pill: the client's currently selected execution mode.
            // This is display-only — the mode is not yet bound into the
            // server-side approval request (mode-pill honesty track), so
            // the card shows the user's selection, never a guessed lane.
            mode={executionMode}
            // An expired gate's "Retry" re-requests a fresh gate — re-POSTing
            // the dead pausedRunId would 409. Other failures retry the
            // approval POST as before.
            onRetry={approvalExpired ? handleReRequestApproval : () => handleResolveApproval("approved")}
          />
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
        onToggleLive={() => {
          // The live voice overlay (z-[10020]) renders under the mobile sheet
          // (z-[10021]) — close the sheet so the voice session is visible.
          setMobileLittOpen(false);
          setLivePanelOpen((v) => !v);
        }}
        liveActive={livePanelOpen && liveSession.isLive}
        contextLine={contextLine}
        hideContextLine={isMobileLitt}
        compact={isMobileLitt}
        onClearSelectedElement={() => setPreviewSelection(null)}
        executionMode={executionMode}
        onExecutionModeChange={setExecutionMode}
        executionHint={executionHint}
      />
    </>
  );

  const littLiveContent = (
    <LiTTLiveActivity
      onOpenFile={(_filePath) => {
        setDestination("studio");
        setStudioMode("code");
      }}
      onOpenDiff={() => {
        handleOpenDockTab("activity");
      }}
      onOpenCheck={() => {
        handleOpenDockTab("terminal");
      }}
      onOpenTerminal={handleOpenTerminal}
      onStop={() => {
        conversation.cancel();
        useExecutionStore.getState().endRun("cancelled");
      }}
      onRollback={handleRollback}
      onResolveApproval={handleResolveApproval}
    />
  );

  // ── Phase D.1: canonical StudioContext (controlled props) ─────────
  // The four authoritative values are controlled props — the provider
  // does NOT mirror them. workspaceMode is INDEPENDENT from creator:
  // when a creator is active, we use the last workspace stage so the
  // context can represent { workspaceMode: "code", creator: "image" }.
  const studioWorkspaceMode = destination === "studio"
    ? (deriveWorkspaceStage(destination, studioMode) ?? lastWorkspaceStage)
    : lastWorkspaceStage;
  const studioCreator = deriveCreator(destination, studioMode, createMode);
  // sessionId: reuse the canonical conversationId when available.
  // Deterministic fallback: project-scoped if a project is active,
  // otherwise a stable "studio:default" — never random.
  const studioSessionId = conversation.selectedConversationId
    ?? (capabilities.projectId ? `project:${capabilities.projectId}` : "studio:default");

  return (
    <StudioContextProvider
      projectId={capabilities.projectId ?? null}
      sessionId={studioSessionId}
      workspaceMode={studioWorkspaceMode}
      creator={studioCreator}
      selection={studioSelection}
      onSelectionChange={(next) => {
        setPreviewSelection(next ? { label: next.content ?? next.elementId, selector: next.elementId, tagName: next.componentName ?? "element" } : null);
      }}
      onWorkspaceModeChange={(mode) => {
        const mapped = workspaceStageToMode(mode);
        setStudioMode(mapped);
        setDestination("studio");
        // Explicit stage selection exits the Builder surface.
        setWorkSurface("conversation");
      }}
      onCreatorChange={(c) => {
        if (c === null) {
          // Exit creator surface — return to the last workspace stage.
          setDestination("studio");
          setStudioMode(workspaceStageToMode(lastWorkspaceStage));
          return;
        }
        // Delegate to existing routing: create-mode creators go through
        // the Create destination; "design" goes through Studio/design.
        if (c === "design") {
          setStudioMode("design");
          setDestination("studio");
        } else {
          setCreateMode(c as CreateMode);
          setDestination("create");
        }
      }}
    >
    <>
      <AgentVoiceSync />

      <div
        className="studio-shell flex h-full w-full flex-col overflow-hidden"
        data-layout={theme.layoutStyle}
        data-studio-chrome
        style={{
          backgroundColor: "var(--bg-main)",
          color: "var(--text-main)",
          backgroundImage: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139,92,246,0.06), transparent)",
        }}
      >
        {/* One compact header — replaces AutonomicLoopBanner + StudioTopBar */}
        <CommandStudioHeader
          onPreviewAction={handlePreview}
          onToggleDockAction={handleToggleDock}
          onOpenDockTabAction={handleOpenDockTab}
          dockOpen={dockOpen}
          onProjectSelectAction={handleSelectProject}
          onCreateProjectAction={openProjectNameDialog}
          onDeleteProjectAction={handleDeleteProject}
          onProjectRenamedAction={(projectId, name) => {
            if (capabilities.projectId !== projectId) return;
            refreshCapabilities();
            window.dispatchEvent(new CustomEvent("studio:project-renamed", { detail: { projectId, name } }));
          }}
          onDeployAction={handleDeployRequest}
          onClearChatAction={conversation.clear}
          onNewChatAction={() => { void conversation.createConversation(); }}
          onDeleteChatAction={() => { void conversation.deleteConversation(); }}
          onRenameChatAction={() => {
            const title = window.prompt("Rename conversation:", conversation.conversations.find((c) => c.id === conversation.selectedConversationId)?.title ?? "");
            if (title) void conversation.renameConversation(title);
          }}
          onExportChatAction={() => conversation.exportConversation()}
          hasConversation={Boolean(conversation.selectedConversationId)}
          runtime={runtimeState}
          runtimeLoading={runtime ? runtime.loading || capabilitiesLoading : true}
          mutationActionsAllowed={launchpadState.mutationActionsAllowed}
          capabilities={capabilities}
          busy={conversation.busy}
          approvalPending={Boolean(pendingApproval)}
          executionMode={executionMode}
          onExecutionModeChange={setExecutionMode}
        />

        {/* Body: LiTT (left) | Workspace (right) — canvas-first 2-zone layout.
            - LiTTPanel is the collapsible chat zone (expanded: resizable
              Chat/Live tabs; collapsed: 64px ambient HUD rail).
            - The workspace <main> is the canvas zone: Design / Code /
              Preview tabs consume ALL remaining width. No permanent
              secondary columns are ever reserved.
            - Files, Terminal, Inspector, Assets, Media live in the
              toggleable bottom StudioDock; advanced tools open as
              drawers/sheets/overlays.
            Mobile behavior is unchanged: ContextDrawer is a right-side fixed
            overlay, LiTTPanel is a mobile sheet, Preview is a workspace tab. */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* Desktop ContextDrawer removed (P2): Files, Inspector, Activity,
              and the terminal now live in the bottom StudioDock, toggled
              from the top command bar. The mobile ContextDrawer overlay
              below is unchanged. */}

          {/* LiTT panel — CENTER on desktop/laptop (>=1024px).
              Was on the left (Phase C2); moved to center in Phase 1.
              Expanded: resizable width with Chat/Live tabs.
              Collapsed: 64px ambient HUD with phase/voice indicators.
              Below 1024px, LiTT is NOT rendered here at all — it is
              accessed via the mobile trigger + overlay sheet below
              (Phase C2.1). */}
          {viewportTier !== null && !isMobileLitt && (
            <>
              <LiTTPanel
                collapsed={littCollapsed}
                onCollapse={() => setLittCollapsed(true)}
                onExpand={() => setLittCollapsed(false)}
                activeTab={littActiveTab}
                onTabChange={setLittActiveTab}
                voiceConnected={liveSession.isLive}
                microphoneStatus={liveSession.indicators.microphone}
                chatContent={littChatContent}
                liveContent={littLiveContent}
                expandedWidth={littResize.width}
              />
              {/* Resize handle — between LiTT (center) and workspace (right).
                  direction="left": dragging right grows the LiTT panel. */}
              {!littCollapsed && (
                <ResizeHandle
                  onDragStart={littResize.onDragStart}
                  onReset={littResize.reset}
                  isDragging={littResize.isDragging}
                  direction="left"
                  ariaLabel="Resize LiTT panel"
                  testId="litt-resize-handle"
                />
              )}
            </>
          )}

          <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden overflow-x-hidden">
            {/* Persistent primary workspace switcher. The main workspace has
                one mode at a time; the Preview tab is the live preview —
                it always consumes the full workspace width. */}
            <div
              className="glass-shell flex shrink-0 items-center gap-0.5 border-b px-2"
              style={{
                height: 36,
                backgroundColor: "rgba(13,9,22,0.85)",
                borderColor: "rgba(155,77,255,0.1)",
              }}
            >
              {workspaceTabs.map((t) => {
                const tabMode = workspaceStageToMode(t.id);
                const isActive = destination === "studio" && studioMode === tabMode
                  && (t.id !== "plan" || workSurface !== "builder");
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setDestination("studio");
                      setStudioMode(tabMode);
                      // Any explicit stage selection exits the Builder surface.
                      setWorkSurface("conversation");
                    }}
                    className={`relative rounded-md px-3 py-1.5 text-[13px] font-bold transition-all ${isActive ? "glass-active" : ""}`}
                    style={{
                      color: isActive ? "var(--text-main)" : "var(--text-dim)",
                      backgroundColor: isActive ? "var(--purple-soft)" : "transparent",
                    }}
                    aria-label={t.label}
                    data-testid={`workspace-tab-${t.id}`}
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
              {/* Work/Files removed (P2): they now live in the bottom dock,
                  toggled from the top command bar. */}
            </div>

            {/* Workspace content — a single primary surface. No second pane
                is ever reserved beside it; the canvas zone takes all
                remaining width whether chat is expanded or collapsed. */}
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div
                className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                data-testid="studio-center-workspace"
              >
                {isPlan ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <StudioPlanSurface
                      capabilities={capabilities}
                      modelLabel={modelLabel}
                      onOpenCode={() => { setDestination("studio"); setStudioMode("code"); }}
                      onOpenCanvas={() => { setDestination("studio"); setStudioMode("files"); }}
                      onOpenPreview={() => { setDestination("studio"); setStudioMode("preview"); }}
                      onOpenTerminal={handleOpenTerminal}
                      onOpenActivity={() => handleOpenDockTab("activity")}
                      onOpenFiles={handleOpenContextFiles}
                      onRollback={handleRollback}
                    />
                  </div>
                ) : isCanvas ? (
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
                  /* Preview is the primary workspace tab — the live preview
                     consumes the full workspace width. No second preview
                     column is ever mounted beside it (canvas-first 2-zone
                     layout). */
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                    <StudioPreviewPanel
                      projectId={capabilities.projectId}
                      projectName={capabilities.projectName}
                      repositoryName={capabilities.repositoryName}
                      branch={capabilities.activeBranch}
                      sourceKind={capabilities.sourceKind}
                      sourceStatus={capabilities.sourceStatus}
                      versionControl={capabilities.versionControl}
                      workspaceStatus={capabilities.workspaceStatus ?? null}
                      onSelectionChange={setPreviewSelection}
                    />
                  </div>
                ) : isMedia ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto pb-28 lg:pb-0">
                    <MediaWorkspacePanel
                      projectId={capabilities.projectId}
                      onOpenCreate={() => handleOpenDockTab("media")}
                    />
                  </div>
                ) : WorkspaceComponent ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto pb-28 lg:pb-0">
                    {studioCreator ? (
                      <StudioCreatorHost>
                        <WorkspaceComponent
                          key={creatorDraftEpoch}
                          projectId={capabilities.projectId}
                          initialPrompt={activeLegacyTool === "video" ? videoStudioPrompt : imageStudioPrompt}
                        />
                      </StudioCreatorHost>
                    ) : (
                      <WorkspaceComponent
                        key={creatorDraftEpoch}
                        projectId={capabilities.projectId}
                        initialPrompt={activeLegacyTool === "video" ? videoStudioPrompt : imageStudioPrompt}
                      />
                    )}
                  </div>
                ) : (
                  <StudioUnavailableSurface
                    destination={destination}
                    capabilities={capabilities}
                    modelLabel={modelLabel}
                  />
                )}
              </div>
            </div>

            {/* Studio dock — bottom (P2/P3). Replaces the old bottom
                StudioDrawer and the desktop ContextDrawer: Activity |
                Files | Terminal | Inspector | Media. The terminal stays
                mounted (display:none when inactive) so the PTY survives
                tab switches and auto-connect keeps working. */}
            <StudioDock
              open={dockOpen}
              activeTab={dockTab}
              onTabChange={setDockTab}
              onClose={() => setDockOpen(false)}
              onToggle={handleToggleDock}
              height={dockHeight}
              onHeightChange={setDockHeight}
              activityPulse={conversation.busy}
              terminalBadge={["error", "pty_failed", "auth_failed"].includes(capabilities.terminalStatus)}
              activityContent={
                <StudioActivityPanel
                  messages={conversation.messages}
                  busy={conversation.busy}
                  modelLabel={modelLabel}
                  projectName={capabilities.projectName}
                  terminalStatus={capabilities.terminalStatus}
                  missionContent={
                    <MissionCards
                      capabilities={capabilities}
                      modelLabel={modelLabel}
                      onOpenCode={() => { setDestination("studio"); setStudioMode("code"); }}
                      onOpenCanvas={() => { setDestination("studio"); setStudioMode("files"); }}
                      onOpenPreview={handlePreview}
                      onOpenTerminal={handleOpenTerminal}
                      onOpenActivity={() => handleOpenDockTab("activity")}
                      onOpenFiles={() => handleOpenDockTab("files")}
                      onRollback={handleRollback}
                    />
                  }
                />
              }
              filesContent={
                <div className="flex h-full flex-col overflow-hidden">
                  <div
                    className="flex shrink-0 items-center justify-between border-b px-2.5 py-2"
                    style={{ borderColor: "rgba(255,255,255,0.07)" }}
                  >
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.12em]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Files / Components
                    </span>
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
              }
              terminalContent={
                <StudioTerminalDrawer
                  projectId={capabilities.projectId}
                  repositoryName={capabilities.repositoryName}
                  branch={capabilities.activeBranch ?? capabilities.defaultBranch}
                  visible={dockOpen && dockTab === "terminal"}
                />
              }
              inspectorContent={
                <StudioInspector
                  embedded
                  open={true}
                  onToggle={() => setDockOpen(false)}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                  data={{
                    capabilities,
                    modelLabel,
                    modelHealth,
                    activeAgentName: AGENT_META[activeAgentId]?.displayName ?? "LiTT",
                    destination,
                    surface: studioMode,
                    messages: conversation.messages,
                    busy: conversation.busy,
                    workspaceRevision,
                    healthRunTrigger,
                    onFilesSaved: () => setWorkspaceRevision((value) => value + 1),
                    onWorkspacePrepared: () => { void refreshCapabilities(); },
                  }}
                />
              }
              mediaContent={<MediaUtilityDock />}
            />
          </main>

          {/* Mobile Context Drawer — right-side fixed overlay (unchanged).
              On mobile, the ContextDrawer is NOT repositioned to the left;
              it stays as a right-side overlay (position defaults to "right").
              Only the desktop instance above uses position="left". */}
          {viewportTier !== null && isMobileLitt && (
            <ContextDrawer
              open={contextDrawerOpen}
              activeTab={contextDrawerTab}
              onTabChange={setContextDrawerTab}
              onClose={() => setContextDrawerOpen(false)}
              width={contextResize.width}
              workContent={littLiveContent}
              filesContent={
                <div className="flex h-full flex-col overflow-hidden">
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
              }
              assetsContent={
                <AssetsPanel projectId={capabilities.projectId} />
              }
              inspectorContent={
                <StudioInspector
                  embedded
                  open={true}
                  onToggle={() => setContextDrawerOpen(false)}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                  data={{
                    capabilities,
                    modelLabel,
                    modelHealth,
                    activeAgentName: AGENT_META[activeAgentId]?.displayName ?? "LiTT",
                    destination,
                    surface: studioMode,
                    messages: conversation.messages,
                    busy: conversation.busy,
                    workspaceRevision,
                    healthRunTrigger,
                    onFilesSaved: () => setWorkspaceRevision((value) => value + 1),
                    onWorkspacePrepared: () => { void refreshCapabilities(); },
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

        {/* Mobile LiTT FAB trigger (<1024px) — Phase C2.1. Secondary
            affordance now: the Chat|Canvas segmented switcher above is the
            primary fast path. The sheet reuses the exact same
            littChatContent / littLiveContent used by the desktop rail —
            never both at once. Hidden while the dock, context drawer,
            canvas overlay, or live voice overlay is open: at z-[10015]
            the FAB would float over their scrims and cover tool action
            buttons. */}
        {/* Mobile Chat|Canvas fast switcher — canvas-first 2-zone layout.
            One primary surface dominates at a time on mobile; this compact
            segmented control is the primary fast path between Chat and
            Canvas, always thumb-reachable just above the bottom nav on the
            canvas view. Both surfaces stay mounted and toggle via
            visibility/display (same pattern as LiTTPanel's display:none
            collapse), so SSE connections, scroll position, and unsent
            composer drafts survive switching. Hidden while the dock,
            context drawer, canvas overlay, or live voice overlay owns the
            screen (same gate as the FAB trigger below). The segmented
            control is a tablist: the active segment marks the visible
            surface; tapping the other surface switches to it. */}
        {isMobileLitt && !mobileLittOpen && !dockOpen && !contextDrawerOpen && !canvasOpen && !livePanelOpen && (
          <div
            className="fixed left-1/2 z-[10015] flex -translate-x-1/2 items-center gap-0.5 rounded-full border p-1 shadow-lg"
            style={{
              bottom: "calc(var(--studio-mobile-bottom-h) + env(safe-area-inset-bottom) + 12px)",
              backgroundColor: "var(--studio-surface)",
              borderColor: "var(--studio-border-strong)",
              backdropFilter: "blur(12px)",
            }}
            role="tablist"
            aria-label="Switch between chat and canvas"
            data-testid="mobile-surface-switcher"
          >
            <button
              type="button"
              role="tab"
              aria-selected={false}
              onClick={() => setMobileLittOpen(true)}
              className="min-h-[40px] rounded-full px-4 text-[12px] font-bold transition active:scale-95"
              style={{ color: "var(--text-muted)" }}
              data-testid="mobile-switch-chat"
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className="min-h-[40px] rounded-full bg-accent/15 px-4 text-[12px] font-bold text-accent transition"
              data-testid="mobile-switch-canvas"
            >
              Canvas
            </button>
          </div>
        )}
        {isMobileLitt && !mobileLittOpen && !dockOpen && !contextDrawerOpen && !canvasOpen && !livePanelOpen && (
          <button
            type="button"
            onClick={() => setMobileLittOpen(true)}
            className="fixed z-[10015] grid h-11 w-11 place-items-center rounded-full border shadow-lg transition active:scale-95"
            style={{
              right: 12,
              bottom: "calc(var(--studio-mobile-bottom-h) + env(safe-area-inset-bottom) + 12px)",
              backgroundColor: "var(--studio-surface)",
              borderColor: "var(--studio-border-strong)",
              color: "var(--litt-primary)",
              backdropFilter: "blur(12px)",
            }}
            aria-label="Ask LiTT to build"
            title="Ask LiTT to build"
            data-testid="litt-mobile-trigger"
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-black"
              style={{
                background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.15))",
              }}
              aria-hidden
            >
              L
            </span>
          </button>
        )}
        {/* Mobile Chat surface — stays MOUNTED on the mobile tier and
            toggles via display (same pattern as LiTTPanel's display:none
            collapse), so SSE connections, scroll position, and unsent
            composer drafts survive Chat <-> Canvas switching. The backdrop
            and sheet are fixed-position, so the display:none wrapper hides
            the whole overlay without affecting layout. */}
        {isMobileLitt && (
          <div
            style={{ display: mobileLittOpen ? undefined : "none" }}
            data-testid="litt-mobile-sheet-mount"
            aria-hidden={!mobileLittOpen}
          >
            <LiTTMobileSheet
              activeTab={littActiveTab}
              onTabChange={setLittActiveTab}
              onClose={() => { setMobileLittOpen(false); setMobileBuildOpen(false); setMobileToolsOpen(false); }}
              chatContent={littChatContent}
              liveContent={littLiveContent}
              projectName={capabilities.projectName}
              branch={capabilities.activeBranch}
              onOpenTools={() => setMobileToolsOpen(true)}
            />
          </div>
        )}
        {/* Mobile density redesign: Build status sheet — the existing
            MissionCards with the actions card hidden (actions live in the
            Tools sheet; hints render above the mission card). */}
        {isMobileLitt && mobileLittOpen && mobileBuildOpen && (
          <MobileBottomSheet
            open={mobileBuildOpen}
            onClose={() => setMobileBuildOpen(false)}
            title="Build status"
            testId="mobile-build-sheet"
          >
            <MissionCards {...missionCardsHandlers} showActions={false} />
          </MobileBottomSheet>
        )}
        {/* Mobile density redesign: Tools sheet — Code, Canvas, Preview,
            Files, Terminal, Activity in one place. */}
        {isMobileLitt && mobileLittOpen && mobileToolsOpen && (
          <MobileBottomSheet
            open={mobileToolsOpen}
            onClose={() => setMobileToolsOpen(false)}
            title="Tools"
            testId="mobile-tools-dialog"
          >
            <MobileToolsSheet
              onOpenCode={openMobileTool(() => { setDestination("studio"); setStudioMode("code"); })}
              onOpenCanvas={openMobileTool(() => { setDestination("studio"); setStudioMode("files"); })}
              onOpenPreview={openMobileTool(handlePreview)}
              onOpenFiles={openMobileTool(() => handleOpenDockTab("files"))}
              onOpenTerminal={openMobileTool(handleOpenTerminal)}
              onOpenActivity={openMobileTool(() => handleOpenDockTab("activity"))}
              onOpenImage={openMobileTool(() => { setCreateMode("image"); setDestination("create"); })}
              onOpenVideo={openMobileTool(() => { setCreateMode("video"); setDestination("create"); })}
              onOpenAudio={openMobileTool(() => { setCreateMode("audio"); setDestination("create"); })}
              onOpenMusic={openMobileTool(() => { setCreateMode("music"); setDestination("create"); })}
            />
          </MobileBottomSheet>
        )}
        {/* TEMPORARY: real-phone diagnostic HUD — opt-in only (?mobileDiag=1),
            remove once mobile Studio is confirmed working end-to-end on device. */}
        {isMobileLitt && isMobileDiagEnabled(searchParams) && <MobileDiagOverlay />}
      </div>

      <ProjectNameDialog
        open={projectNameDialogOpen}
        busy={creatingProject}
        error={projectCreateError}
        onCancel={() => { if (!creatingProject) setProjectNameDialogOpen(false); }}
        onSubmit={(name) => { void handleStartBlank(name); }}
      />

      {/* Canvas overlay — opens when a canvas action is executed from chat */}
      {canvasOpen && (
        <aside
          className="fixed z-[10009] flex flex-col overflow-hidden border shadow-2xl md:bottom-0 md:right-0 md:top-[calc(var(--studio-header-h)+4px)] md:w-full md:max-w-[520px] md:border-l bottom-[calc(var(--studio-mobile-bottom-h)+env(safe-area-inset-bottom))] left-0 right-0 top-auto h-[55dvh] rounded-t-2xl border-t"
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
    </StudioContextProvider>
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
  const sourceRow = describeSourceRows(capabilities);
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
        {/*
          Project facts. Source ownership, version control and GitHub are
          THREE separate rows because they are three separate things: a
          managed project has durable source and real Git history while
          having no GitHub repository, and collapsing them produced the
          misleading "Repository: Not connected" on a healthy project.
          grid-cols-1 on narrow widths so the rows are never crushed.
        */}
        <div className="grid grid-cols-1 gap-2 text-[10px] sm:grid-cols-2" data-testid="studio-project-facts">
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Project</span><div className="mt-1 truncate font-bold" style={{ color: "var(--text-primary)" }}>{capabilities.projectName ?? "Not selected"}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Model</span><div className="mt-1 truncate font-bold" style={{ color: "var(--text-primary)" }}>{modelLabel}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Source</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.sourceStatus === "error" ? "var(--text-primary)" : "var(--litt-primary)" }} data-testid="project-fact-source">{sourceRow.source}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Version control</span><div className="mt-1 truncate font-bold" style={{ color: "var(--text-primary)" }} data-testid="project-fact-vcs">{sourceRow.versionControl}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Branch</span><div className="mt-1 truncate font-bold" style={{ color: "var(--text-primary)" }} data-testid="project-fact-branch">{sourceRow.branch}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Workspace</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.workspaceStatus === "ready" ? "var(--litt-primary)" : "var(--text-primary)" }} data-testid="project-fact-workspace">{sourceRow.workspace}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Write access</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.writeAccess ? "var(--litt-primary)" : "var(--text-primary)" }} data-testid="project-fact-write">{capabilities.writeAccess ? "Allowed" : "Not available"}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>GitHub</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.githubConnected ? "var(--litt-primary)" : "var(--text-primary)" }} data-testid="project-fact-github">{sourceRow.github}</div></div>
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--studio-border)" }}><span style={{ color: "var(--text-muted)" }}>Terminal</span><div className="mt-1 truncate font-bold" style={{ color: capabilities.terminalStatus === "connected" ? "var(--litt-primary)" : "var(--text-primary)" }}>{capabilities.terminalStatus}</div></div>
        </div>
      </div>
    </div>
  );
}

export { describeSourceRows };

/* ── Media workspace panel — generated images, video, music, audio ── */
function MediaWorkspacePanel({
  projectId,
  onOpenCreate,
}: {
  projectId: string | null;
  onOpenCreate: () => void;
}) {
  const modeLabel = "Media";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-black uppercase tracking-[0.12em]"
            style={{ color: "var(--litt-primary)" }}
          >
            {modeLabel}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Your creations, in one place
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="text-center" style={{ color: "var(--text-muted)" }}>
          <div
            className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,0.1), rgba(99,102,241,0.05))",
              border: "1px solid rgba(139,92,246,0.15)",
            }}
          >
            <ImageIcon size={20} style={{ color: "var(--litt-primary)" }} />
          </div>
          <p className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>
            No {modeLabel.toLowerCase()} artifacts yet
          </p>
          <p className="mt-1 text-xs">
            Use the media tools in this workspace to create an image, video, or audio asset.
          </p>
          <button
            type="button"
            onClick={onOpenCreate}
            className="mt-4 rounded-xl px-4 py-2 text-xs font-bold transition hover:opacity-80"
            style={{
              backgroundColor: "rgba(77,255,98,0.12)",
              color: "var(--litt-primary)",
              border: "1px solid rgba(77,255,98,0.3)",
            }}
          >
            Open media tools
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Studio/Work surface: empty state OR real transcript ──────── */
function StudioWorkSurface({
  messages,
  conversationId,
  busy,
  loading,
  activeAgentId,
  fallbackNotice,
  onRouteToolAction,
  onRegenerateAction,
  onSelectConversation,
  launchpadState,
  displayName,
  onFirstMissionAction,
  completion,
  onDismissCompletion,
  onUndoCompletion,
  onContinueCompletion,
  overflowDownloads = false,
}: {
  messages: import("../stores/useStudioAgentStore").ChatMessage[];
  conversationId: string | null;
  busy: boolean;
  loading: boolean;
  activeAgentId: import("../stores/useStudioAgentStore").AgentId;
  fallbackNotice: string | null;
  onRouteToolAction: (tool: StudioTool, command?: string) => void;
  onRegenerateAction: (assistantMessageId?: string) => void;
  onSelectConversation?: (conversationId: string) => void;
  launchpadState: FirstMissionLaunchpadState;
  displayName?: string | null;
  onFirstMissionAction: (action: FirstMissionActionId) => void;
  completion?: { changes: MutationSummary; previewUpdated: boolean; repaired: boolean } | null;
  onDismissCompletion?: () => void;
  onUndoCompletion?: () => void;
  onContinueCompletion?: () => void;
  overflowDownloads?: boolean;
}) {
  // P0.14-15: Only show empty state when messages are truly empty AND
  // conversations have finished loading from the server. During loading,
  // show a minimal spinner so users don't see the welcome screen flash.
  const isEmpty = messages.length === 0 && !loading;
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
      {conversationId && <ActionRunStatusPanel conversationId={conversationId} busy={busy} />}
      {isEmpty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LiTEmptyState
            launchpadState={launchpadState}
            displayName={displayName}
            onPrimaryAction={onFirstMissionAction}
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
          completion={completion}
          onDismissCompletion={onDismissCompletion}
          onUndoCompletion={onUndoCompletion}
          onContinueCompletion={onContinueCompletion}
          overflowDownloads={overflowDownloads}
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
