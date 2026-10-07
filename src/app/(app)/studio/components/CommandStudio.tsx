"use client";

import { terminalHealthOf } from "@/lib/studio/terminal-health";
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
import {
  mapStudioTaskToWorktab,
  displayWorktabTitle,
  isPlaceholderTaskTitle,
  resolveAdoptedTaskTitle,
  useWorktabSelections,
  type Worktab,
} from "../hooks/useServerWorktabs";
import { useWorktabBadges } from "../hooks/useWorktabBadges";
import { useLiTTRealtimeSession } from "../hooks/useLiTTRealtimeSession";
import type { LiTTLiveSessionContext } from "@/lib/litt/live/types";
import type { ArtifactAction } from "@/lib/canvas/types";
import { STUDIO_EVENT_OPEN_DOCK, STUDIO_EVENT_OPEN_FILE, STUDIO_EVENT_REQUEST_DEPLOY } from "@/lib/canvas/panel-actions";
import { INITIAL_RUNTIME_STATE, deriveExecutionHint } from "@/lib/projects/runtime-state";
import { useLiTTRuntime } from "@/hooks/useLiTTRuntime";
import {
  isOnboardingComplete,
  markFirstRunPromptConsumed,
  resolveStudioProjectId,
  takeFirstRunPrompt,
} from "../lib/first-run-handoff";

import CommandStudioHeader from "./CommandStudioHeader";
import StudioDock, { type StudioDockTab } from "./StudioDock";
import { ApprovalCard } from "./ApprovalCard";
import MissionCards from "./MissionCards";
import StudioPrimaryAction, { type PrimaryActionState } from "./StudioPrimaryAction";
import PersistentMusicPlayer from "./PersistentMusicPlayer";
import { MobileCommandNav, type MobileStudioSurface } from "./CommandStudioNav";
import CommandComposer, { type ComposerContextLine } from "./CommandComposer";
import LiTEmptyState from "./LiTEmptyState";
import StudioTranscript from "./StudioTranscript";
import { ActionRunStatusPanel } from "./ActionRunStatusPanel";
import StudioBrowserStatusChip from "./StudioBrowserStatusChip";
import { ChatBrowserLiveView } from "./ChatBrowserLiveView";
import LiTTLiveActivity from "./LiTTLiveActivity";
import LiTTPanel from "./LiTTPanel";
import WorktabBar from "./WorktabBar";
import LiTTMobileSheet from "./litt/LiTTMobileSheet";
import MobileBuildStatusBar from "./litt/MobileBuildStatus";
import MobileToolsSheet from "./litt/MobileToolsSheet";
import MobileBottomSheet from "./sheets/MobileBottomSheet";
import MobileDiagOverlay from "./MobileDiagOverlay";
import { mobileDiag, isMobileDiagEnabled } from "../lib/mobileDiagnostics";
import ContextDrawer, { type ContextDrawerTab } from "./context/ContextDrawer";
import AssetsPanel from "./context/AssetsPanel";
import { StudioContextProvider, isStudioSelectionPayload, type StudioSelectionPayload, type StudioSelectionValue } from "../context/StudioContext";
import { deriveCreator, deriveWorkspaceStage } from "../context/derive-studio-context";
import { StudioCreatorHost } from "./creators/StudioCreatorHost";
import { useViewportTier } from "../hooks/useViewportTier";
import { useStudioTasks } from "../hooks/useStudioTasks";
import { useProjectIsolation } from "../hooks/useProjectIsolation";
import type { StudioTask } from "@/lib/studio/task-types";
import { useResizableWidth } from "../hooks/useResizableWidth";
import { useExecutionStore, type MutationSummary } from "../stores/useExecutionStore";
import { submitApprovalAndPoll, watchApprovalResolution, type ApprovalRunResult } from "../lib/approval-polling";
import { StudioActivityPanel, StudioInspector } from "./StudioWorkspaceFrame";
import StudioShell from "./shell/StudioShell";
import WorkspaceRail from "./shell/WorkspaceRail";
import ContextInspector from "./shell/ContextInspector";
import LiTTCommandLayer from "./shell/LiTTCommandLayer";
import ResizeHandle from "./shell/ResizeHandle";
import StudioDeploySurface from "./shell/StudioDeploySurface";
import StudioOperatorBar from "./shell/StudioOperatorBar";
import ElementInspectorPanel from "./shell/ElementInspectorPanel";
import ImageStudio from "./shell/ImageStudio";
import { canonicalSurfaceToPersist, modeToStageSurface, resolveStageSurface, type StudioStageSurface } from "./shell/stage-surfaces";
import { centerStation, resolveInitialStation, stationToToolParam, toolParamToStation } from "./shell/station-url";
import { useCanvasBuilderStore } from "./canvas/builder/store";
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
const StudioBrowserJobsPanel = dynamic(() => import("./StudioBrowserJobsPanel"), { ssr: false });
const BuilderPropertiesPanel = dynamic(() => import("./canvas/builder/PropertiesPanel").then((m) => m.PropertiesPanel), { ssr: false });
const MissionForge = dynamic(() => import("../tools/MissionForge"), { ssr: false });
const CLIBridgeTool = dynamic(() => import("../tools/CLIBridgeTool"), { ssr: false });
const SpaceTool = dynamic(() => import("../tools/SpaceTool"), { ssr: false });
const PluginsTool = dynamic(() => import("../tools/PluginsTool"), { ssr: false });
const CameraTool = dynamic(() => import("../tools/CameraTool"), { ssr: false });
const ScreenTool = dynamic(() => import("../tools/ScreenTool"), { ssr: false });
const LiveVoiceOverlay = dynamic(() => import("./LiveVoiceOverlay"), { ssr: false });

type DockPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "full";

/** Desktop shell: dock-tab actions map onto stage surfaces (or the
    inspector). In mobile/classic they still drive the real bottom dock. */
const DOCK_TAB_TO_SURFACE: Partial<Record<StudioDockTab, StudioStageSurface>> = {
  activity: "activity",
  files: "files",
  terminal: "terminal",
  media: "images",
};

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
  const activeProjectId = resolveStudioProjectId(searchParams.get("project"));
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
  // ── Welcome-state routing (Larry's standing rule) ──────────────────
  // The center "Welcome to LiTT" onboarding shows ONLY for a brand-new
  // untouched project. The first successful build/edit permanently
  // transitions the center into the active workspace: when the project was
  // touched (starter-scaffolding manifest consumed by the first write, or a
  // second git commit landed) but the entry file still carries the
  // welcome-screen marker (e.g. a trivial additive edit to the starter,
  // not a real build), default the center to the Code surface — the active
  // workspace showing the user's actual files — instead of the Preview
  // surface rendering the starter welcome page as if it were onboarding.
  // Runs once per project on initial load; never overrides a manual surface
  // choice (a switch back to Preview after the reroute is respected), and
  // fails soft (keeps preview) if the check errors.
  const projectIdForWelcomeRouting = capabilities.projectId;
  const studioModeForWelcomeRouting = studioMode;
  const welcomeRoutingDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (destination !== "studio") return;
    if (!projectIdForWelcomeRouting) return;
    // Never override an explicit surface choice — only reroute from the
    // default preview surface, and only once per project.
    if (studioModeForWelcomeRouting !== "preview") return;
    if (welcomeRoutingDoneRef.current === projectIdForWelcomeRouting) return;
    welcomeRoutingDoneRef.current = projectIdForWelcomeRouting;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken?.();
        const res = await fetch(
          `/api/studio-projects/${encodeURIComponent(projectIdForWelcomeRouting)}/workspace-state`,
          {
            cache: "no-store",
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!res.ok || cancelled) return;
        const state = (await res.json().catch(() => null)) as {
          scaffolded?: boolean;
          touched?: boolean;
          starterContent?: boolean;
        } | null;
        // Touched by either signal: the robust git/file check, or the
        // scaffold-manifest check. Both mean "first build/edit landed".
        const wasTouched = state?.touched === true || state?.scaffolded === false;
        if (state && wasTouched && state.starterContent === true && !cancelled) {
          setStudioMode("code");
        }
      } catch {
        // Fail-soft: keep the default preview surface.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destination, projectIdForWelcomeRouting, studioModeForWelcomeRouting, getToken]);
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
  const [, setMissionMode] = useState<MissionMode>(
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
  // F1: holds the full StudioSelectionPayload when present, so the structured
  // selection reaches the real LLM send context — not just composer chrome.
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | StudioSelectionPayload | null>(null);
  // F1: session-scoped ask-litt selection pinned per server task id.
  // Ephemeral by design (never persisted) — declared up here because the
  // studio:ask-litt listener below stamps into it.
  const { selections: worktabSelections, setSelection: setWorktabSelection } =
    useWorktabSelections();
  const studioSelection: StudioSelectionValue | null = previewSelection
    ? isStudioSelectionPayload(previewSelection)
      ? previewSelection
      : { elementId: previewSelection.selector, componentName: previewSelection.tagName, content: previewSelection.label }
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

  // ── Phase 3B: Primary action state derivation ──────────────────────
  // Derives the one primary action from existing execution/approval/deployment
  // state. Uses no new state machine; all handlers are existing.
  const primaryActionState: PrimaryActionState = (() => {
    // Approval required takes precedence — canonical ApprovalCard is actionable
    if (pendingApproval) return "approval_required";
    // TODO: Derive building/publishing/live from execution store and
    // deployment projection once the preview integration is verified.
    // For now, idle when no approval is pending.
    return "idle";
  })();

  // Focus the canonical ApprovalCard (scrolls to it, no duplicate button)
  const handleFocusApproval = useCallback(() => {
    const el = document.querySelector('[data-testid="approval-card"]');
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // ── StudioShell — the desktop Studio destination IS the operating
  // shell: workspace rail + central stage + contextual inspector + the
  // LiTT command layer at the bottom. Mobile keeps its sheet/nav model;
  // non-studio destinations keep the classic body below.
  const viewportTier = useViewportTier();
  const isMobileLitt = viewportTier === "mobile";

  // Hidden escape hatch while the shell migration lands: the classic
  // panel layout is also the mobile/non-studio body — honoring this pref
  // keeps it reachable on desktop. There is intentionally NO toggle UI.
  const [classicOverride] = useState(() => {
    try {
      return window.localStorage.getItem("litt:studio:layout-mode") === "classic";
    } catch {
      return false;
    }
  });

  const studioShellActive =
    destination === "studio" && viewportTier !== null && !isMobileLitt && !classicOverride;
  // Initial station honors an explicit ?tool= deep link (URL, state and
  // the visible station must agree from the first paint).
  const [stageSurface, setStageSurface] = useState<StudioStageSurface>(() =>
    resolveInitialStation(searchParams.get("tool"), null),
  );
  // First-run Studio should present one clear action. Keep the inspector
  // available, but do not make it compete with Chat and Preview before the
  // project has useful state to inspect.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // A real preview/builder selection is useful inspector state. Open it on
  // demand while keeping the clean first-run shell calm.
  useEffect(() => {
    if (previewSelection) setInspectorOpen(true);
  }, [previewSelection]);
  const [littExpanded, setLittExpanded] = useState(false);

  // Surfaces stay mounted once visited — hidden, not unmounted — so
  // preview iframes, PTY sessions, and canvas state survive switching.
  const [mountedSurfaces, setMountedSurfaces] = useState<Set<StudioStageSurface>>(() => new Set(["preview"]));

  // Terminal P0: attach the workspace PTY as soon as a project is open,
  // not only after the user visits the Terminal station. The surface is
  // mounted hidden (stay-alive), so the shell is live — and LiTT's
  // terminal health is green — without the user opening anything.
  // Respects the explicit opt-out ("litt:terminalAutoStart" = "0").
  useEffect(() => {
    if (!studioShellActive || !capabilities.projectId) return;
    try {
      if (window.localStorage.getItem("litt:terminalAutoStart") === "0") return;
    } catch {
      // Storage unavailable — default to auto-attach.
    }
    setMountedSurfaces((prev) => (prev.has("terminal") ? prev : new Set(prev).add("terminal")));
  }, [studioShellActive, capabilities.projectId]);

  const openStageSurface = useCallback((requested: StudioStageSurface) => {
    const surface = centerStation(requested);
    setDestination("studio");
    setStageSurface(surface);
    setMountedSurfaces((prev) => (prev.has(surface) ? prev : new Set(prev).add(surface)));
  }, []);

  // Design-surface node selection → the inspector shows the real
  // property editor (builder store is module-scoped; reads stay cheap).
  const builderSelectedNodeId = useCanvasBuilderStore((s) => s.selectedNodeId);

  const handleToggleDock = useCallback(() => {
    if (studioShellActive) {
      openStageSurface("activity");
      return;
    }
    setDockOpen((v) => !v);
  }, [studioShellActive, openStageSurface]);
  const handleOpenDockTab = useCallback((tab: StudioDockTab) => {
    if (studioShellActive) {
      if (tab === "inspector") {
        setInspectorOpen(true);
      } else {
        const surface = DOCK_TAB_TO_SURFACE[tab];
        if (surface) openStageSurface(surface);
      }
      return;
    }
    setDockTab(tab);
    setDockOpen(true);
  }, [studioShellActive, openStageSurface]);

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
      // Shell: a Studio deep-link selects the corresponding stage surface
      // (drawer overlays map to their surfaces too — terminal, files…).
      if (studioShellActive) {
        // The station named in the URL is authoritative; legacy tool
        // values fall back to the old mode/drawer mapping.
        const legacySurface = mapped.openDrawer
          ? (DOCK_TAB_TO_SURFACE[mapped.openDrawer as StudioDockTab] ?? null)
          : modeToStageSurface(newMode);
        const named = toolParamToStation(fromUrl) ?? legacySurface;
        const surface = named ? centerStation(named) : null;
        if (surface) {
          setStageSurface(surface);
          setMountedSurfaces((prev) => (prev.has(surface) ? prev : new Set(prev).add(surface)));
        }
        if (mapped.openInspector) setInspectorOpen(true);
      }
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
    // studioShellActive in deps: entering Studio via URL from another
    // destination must re-apply the surface mapping on the next render.
  }, [searchParams, studioShellActive]);

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
  const MOBILE_LITT_OPEN_KEY = "littree:studio:mobile-litt-open";

  // Whether the user has an explicit stored collapse preference — captured
  // once at init (constant state) so the mount-time persistence write below
  // can't race the shell first-run default.
  const [littCollapsedHadStoredPref] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      // A value written by the previous localStorage behaviour is still
      // honoured as an explicit preference, so a user who deliberately
      // collapsed the dock is not silently overridden by this change.
      return (
        sessionStorage.getItem(LITT_COLLAPSED_KEY) !== null ||
        localStorage.getItem(LITT_COLLAPSED_KEY) !== null
      );
    } catch {
      return false;
    }
  });

  // Studio enters with LiTT Chat + Workspace, not a collapsed rail.
  //
  // The collapse preference is session-scoped: a manual collapse is honoured
  // for the rest of the session (so refresh and in-session navigation keep the
  // correct state) but no longer pins the panel shut permanently across
  // sessions. Previously the preference lived in localStorage, so once a user
  // collapsed the dock it stayed collapsed on every future visit and the
  // conversation composer rendered hidden.
  const [littCollapsed, setLittCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const session = sessionStorage.getItem(LITT_COLLAPSED_KEY);
      if (session !== null) return session === "true";
      const legacy = localStorage.getItem(LITT_COLLAPSED_KEY);
      if (legacy !== null) return legacy === "true";
    } catch {
      // noop
    }
    return true;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(LITT_COLLAPSED_KEY, String(littCollapsed));
    } catch {
      // ignore
    }
  }, [littCollapsed]);

  // Chat dock position — "left" (persistent left panel, 360px default) or
  // "bottom" (today's bottom command layer). Default "left" per the spec;
  // any stored value other than "bottom" falls back to "left".
  const CHAT_DOCK_KEY = "littree:studio:chat-dock";
  const [chatDock, setChatDock] = useState<"left" | "bottom">(() => {
    if (typeof window === "undefined") return "left";
    try {
      return localStorage.getItem(CHAT_DOCK_KEY) === "bottom" ? "bottom" : "left";
    } catch {
      return "left";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_DOCK_KEY, chatDock);
    } catch {
      // ignore
    }
  }, [chatDock]);

  // Canonical LiTT active tab — single source of truth shared by the
  // desktop rail, the mobile sheet, and header/activity actions.
  const [littActiveTab, setLittActiveTab] = useState<"chat" | "live">("chat");

  // Viewport tier (declared above with the canvas state) drives
  // desktop-rail vs mobile-sheet LiTT presentation — null until first
  // client measurement (SSR-safe — see hook docs).
  const [mobileLittOpen, setMobileLittOpen] = useState(false);
  // On mobile, Studio enters with the LiTT chat surface open. Session-scoped
  // for the same reason as the desktop dock: a manual close sticks for this
  // session, a fresh entry restores it. The composer is never focused
  // automatically, so the on-screen keyboard does not pop.
  const [mobileLittHadStoredPref] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(MOBILE_LITT_OPEN_KEY) !== null;
    } catch {
      return false;
    }
  });
  const mobileLittDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (mobileLittDefaultAppliedRef.current) return;
    if (viewportTier === null) return;
    mobileLittDefaultAppliedRef.current = true;
    if (!isMobileLitt) return;
    if (!mobileLittHadStoredPref) setMobileLittOpen(true);
  }, [viewportTier, isMobileLitt, mobileLittHadStoredPref]);
  useEffect(() => {
    // Only persist once the entry default has been applied — otherwise the
    // mount-time write would immediately masquerade as a stored preference.
    if (!mobileLittDefaultAppliedRef.current) return;
    try {
      sessionStorage.setItem(MOBILE_LITT_OPEN_KEY, String(mobileLittOpen));
    } catch {
      // ignore
    }
  }, [mobileLittOpen]);
  // Mobile density redesign: progressive-disclosure sheet state. Both sheets
  // render only while the mobile chat sheet is open (see mounts below).
  const [mobileBuildOpen, setMobileBuildOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // Phase 3B: Do NOT auto-collapse the conversation when switching work surfaces.
  // The Studio Layout Contract requires conversation LEFT + preview RIGHT on desktop.
  // Users can manually collapse via the dock handle or Esc key, but switching
  // to preview should not hide the conversation automatically.
  const previousStageSurfaceRef = useRef<StudioStageSurface>(stageSurface);
  useEffect(() => {
    if (previousStageSurfaceRef.current === stageSurface) return;
    previousStageSurfaceRef.current = stageSurface;
    // Intentionally NOT calling setLittCollapsed(true) here.
    // Mobile still closes sheets via openMobileTool; desktop keeps both visible.
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileLittOpen(false);
    }
  }, [stageSurface]);
  // Mobile density redesign: opening a tool from the Tools sheet closes both
  // sheets so the chosen tool becomes the one dominant surface (this also
  // fixes the old behavior where tool buttons switched the workspace
  // invisibly behind the open chat sheet).
  const openMobileTool = (fn: () => void) => () => {
    fn();
    setMobileToolsOpen(false);
    setMobileLittOpen(false);
  };

  // F1 workspace-first: LiTT opens on the 64px rail (no permanent
  // desktop column). Expanding opens the floating overlay panel (Slice B).
  // A stored explicit preference is never overridden.
  const laptopDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (laptopDefaultAppliedRef.current) return;
    if (viewportTier === null) return;
    laptopDefaultAppliedRef.current = true;
    // No auto-collapse — expanded by default on all desktop tiers.
  }, [viewportTier]);

  // Shell first-run default: the left chat dock is persistent per the
  // spec, so it opens EXPANDED on first run in the shell path. A stored
  // explicit preference always wins (captured at init — the persistence
  // effect below writes on mount, so localStorage can't be re-read here).
  // The legacy (non-shell) path keeps its own collapsed-first-run default.
  const shellDockDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (shellDockDefaultAppliedRef.current) return;
    if (viewportTier === null) return;
    shellDockDefaultAppliedRef.current = true;
    if (!studioShellActive) return;
    if (!littCollapsedHadStoredPref) setLittCollapsed(false);
  }, [viewportTier, studioShellActive, littCollapsedHadStoredPref]);

  // Esc collapses the left dock — parity with the bottom command layer's
  // Esc behavior. Skipped while typing in an input/textarea/contenteditable.
  useEffect(() => {
    if (!studioShellActive || chatDock !== "left" || littCollapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      setLittCollapsed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studioShellActive, chatDock, littCollapsed]);

  // Resizable pane widths — persisted to localStorage, clamped to min/max.
  // LiTT chat is the PRIMARY surface — wide default (520px) so the
  // conversation has room to breathe. Range 420–640px.
  // NOTE: littResize feeds the LEGACY overlay panel only — it is never
  // touched by the shell dock. The shell dock has its own width state
  // below (littDockResize) under a separate storage key.
  const littResize = useResizableWidth({
    storageKey: "littree:studio:litt-width",
    defaultWidth: 520,
    minWidth: 420,
    maxWidth: 640,
    direction: "left",
  });
  // Shell left-dock width — 360px default, clamped 320–480px per Phase 3B
  // Studio Layout Contract, persisted under its own key so the legacy
  // panel sizing is unaffected.
  const littDockResize = useResizableWidth({
    storageKey: "littree:studio:litt-dock-width",
    defaultWidth: 360,
    minWidth: 320,
    maxWidth: 480,
    direction: "left",
  });

  // Keyboard resize for the left-dock handle: ResizeHandle dispatches
  // "studio:resize-keyboard" on ArrowLeft/ArrowRight. Scoped to the dock
  // handle via its testid so other resize handles are unaffected.
  const dockSetWidth = littDockResize.setWidth;
  const dockWidth = littDockResize.width;
  useEffect(() => {
    if (chatDock !== "left") return;
    const onResizeKey = (e: Event) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active.getAttribute("data-testid") !== "litt-dock-resize") return;
      const delta = (e as CustomEvent).detail?.delta;
      if (typeof delta !== "number") return;
      dockSetWidth(dockWidth + delta);
    };
    window.addEventListener("studio:resize-keyboard", onResizeKey as EventListener);
    return () => window.removeEventListener("studio:resize-keyboard", onResizeKey as EventListener);
  }, [chatDock, dockSetWidth, dockWidth]);
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

  // Mobile is a work-surface dock over the same conversation, execution,
  // preview, file, and activity state used by desktop. Switching a surface
  // never creates a second runtime or stops the active mission.
  const handleMobileSurface = useCallback((surface: MobileStudioSurface) => {
    setMobileBuildOpen(false);
    if (surface === "chat") {
      setMobileToolsOpen(false);
      setLittActiveTab("chat");
      setMobileLittOpen(true);
      return;
    }
    if (surface === "activity") {
      setMobileToolsOpen(false);
      setLittActiveTab("live");
      setMobileLittOpen(true);
      return;
    }
    if (surface === "preview") {
      setMobileLittOpen(false);
      setMobileToolsOpen(false);
      setContextDrawerOpen(false);
      setDestination("studio");
      setStudioMode("preview");
      return;
    }
    if (surface === "files") {
      setMobileLittOpen(false);
      setMobileToolsOpen(false);
      setContextDrawerTab("files");
      setContextDrawerOpen(true);
      return;
    }
    setLittActiveTab("chat");
    setMobileLittOpen(true);
    setMobileToolsOpen(true);
  }, []);

  // Derived booleans for downstream components (must be after state declarations)
  // Activity is an OPEN action. It always opens the bottom dock on the
  // Activity tab, where execution telemetry (tool calls, diffs, checks,
  // approvals) now lives. It never merely flips panel state.
  const handleOpenActivity = useCallback(() => {
    handleOpenDockTab("activity");
  }, [handleOpenDockTab]);

  // Listen for "Ask LiTT" events from Canvas and other surfaces.
  // Opens LiTT, switches to Chat, and optionally pre-fills the composer
  // with context from the requesting surface.
  //
  // F1 (Slice A): detail may carry a structured `selection`
  // (StudioSelectionPayload, canonical in StudioContext). It is pinned
  // to the ACTIVE worktab (session-scoped, survives tab switches) and
  // mirrored into the preview selection so the composer context chips
  // (Slice B) and the legacy context line stay in sync. Dispatchers that
  // send only { prompt } (LiTEmptyState, StudioPreviewPanel) keep working
  // unchanged.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { context?: string; prompt?: string; selection?: StudioSelectionPayload }
        | undefined;
      if (isMobileLitt) {
        setMobileLittOpen(true);
      } else if (studioShellActive) {
        // Shell: Ask LiTT reveals the chat — the left dock panel in
        // left-dock mode, the bottom command layer in bottom-dock mode.
        if (chatDock === "left") {
          setLittCollapsed(false);
        } else {
          setLittExpanded(true);
        }
      } else {
        setLittCollapsed(false);
      }
      setLittActiveTab("chat");
      if (detail?.prompt) {
        setComposerValue(detail.prompt);
      }
      if (detail?.selection) {
        // Read the active task id fresh (no stale closure): the shell keeps
        // the execution store's activeTaskId in sync on every switch/bind.
        const activeTaskId = useExecutionStore.getState().activeTaskId;
        const stamped: StudioSelectionPayload = {
          ...detail.selection,
          worktabId: activeTaskId ?? undefined,
        };
        if (activeTaskId) {
          setWorktabSelection(activeTaskId, stamped);
        }
        // Pass the FULL payload (never the legacy mirror): the send path
        // attaches label + sourceFile/route to the real LLM request.
        setPreviewSelection(stamped);
      }
    };
    window.addEventListener("studio:ask-litt", handler);
    return () => window.removeEventListener("studio:ask-litt", handler);
  }, [isMobileLitt, setWorktabSelection, studioShellActive, chatDock]);

  useEffect(() => {
    const prompt = takeFirstRunPrompt(searchParams.get("prompt"));
    if (!prompt) return;
    setComposerValue((current) => (current.trim() ? current : prompt));
    markFirstRunPromptConsumed();
    if (isMobileLitt) {
      setMobileLittOpen(true);
    } else if (studioShellActive) {
      if (chatDock === "left") {
        setLittCollapsed(false);
      } else {
        setLittExpanded(true);
      }
    } else {
      setLittCollapsed(false);
    }
    setLittActiveTab("chat");
  }, [searchParams, isMobileLitt, studioShellActive, chatDock]);

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
  // viewportTier/layout state declared with the shell block above.

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
        // handleOpenDockTab routes to a stage surface while the shell
        // owns the workspace; classic mode still opens the bottom dock.
        handleOpenDockTab(mapped.openDrawer as StudioDockTab);
      }
    }
    if (mapped.openInspector) {
      handleOpenContextInspector();
      setInspectorTab(mapped.openInspector);
    }
    // Shell: studio workspace modes select the corresponding stage surface.
    if (studioShellActive && mapped.destination === "studio" && !mapped.openDrawer && !mapped.openInspector) {
      const surface = modeToStageSurface(mapped.mode);
      if (surface) openStageSurface(surface);
    }
    setPendingCommand(command);
  }, [capabilities.terminalStatus, handleOpenContextInspector, handleOpenDockTab, studioShellActive, openStageSurface]);

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
    serverProjectId: activeProjectId ?? capabilities.projectId,
    cameraState: { active: cameraDock.open, status: cameraStatus },
    previewSelection,
    // Shared capabilities — the hook must not start a second poll stack.
    capabilities,
  });

  const studioTasks = useStudioTasks(capabilities.projectId);
  const refreshTasks = studioTasks.refresh;
  const taskSeededRef = useRef<string | null>(null);

  // Item 5a — the Activity truth is the persisted action_events log of the
  // current conversation's run. The existing studio_tasks mapping carries it
  // (activeActionRunId while working, latestActionRunId after settle); no
  // parallel mapping is introduced.
  const activityTask = studioTasks.tasks.find((task) => task.conversationId === conversation.selectedConversationId);
  const activityRunId = activityTask?.activeActionRunId ?? activityTask?.latestActionRunId ?? null;

  // Phase 4 — project isolation: the URL's explicit ?project= is
  // authoritative the instant it's present (capabilities.projectId can
  // lag a refresh behind), so project-scoped runtime state resets the
  // moment the switch lands, not after the capabilities round-trip.
  useProjectIsolation(activeProjectId ?? capabilities.projectId);


  useEffect(() => {
    const conversationId = conversation.selectedConversationId;
    if (!conversationId) return;
    const matching = studioTasks.tasks.find((task) => task.conversationId === conversationId);
    if (matching && matching.id !== studioTasks.activeTaskId) {
      studioTasks.setActiveTaskId(matching.id);
      // F1: keep the execution store's active task id aligned too, so
      // event tagging + ask-litt selection attribution follow the tab.
      useExecutionStore.getState().setActiveTaskId(matching.id);
    }
  }, [conversation.selectedConversationId, studioTasks]);

  // Existing conversations are adopted into the durable task model once per
  // project. This avoids creating a new conversation/task on every message,
  // while giving pre-Worktab projects a real task immediately.
  useEffect(() => {
    const conversationId = conversation.selectedConversationId;
    if (!capabilities.projectId || !conversationId || studioTasks.loading) return;
    if (studioTasks.tasks.some((task) => task.conversationId === conversationId)) return;
    if (taskSeededRef.current === conversationId) return;
    taskSeededRef.current = conversationId;
    const selected = conversation.conversations.find((item) => item.id === conversationId);
    void studioTasks.createTask({
      // Untitled conversations stay explicitly first-run until the first
      // prompt gives the task a meaningful name.
      title: resolveAdoptedTaskTitle(
        selected?.title,
        studioTasks.tasks.map((task) => task.title),
      ),
      taskType: "general",
      conversationId,
    });
  }, [capabilities.projectId, conversation.selectedConversationId, conversation, studioTasks]);

  const activateStudioTask = useCallback(async (task: StudioTask) => {
    const activated = await studioTasks.activateTask(task.id, "studio");
    if (!activated?.conversationId || activated.conversationId === conversation.selectedConversationId) return;
    conversation.selectConversation(activated.conversationId);
    await conversation.loadMessages(activated.conversationId);
  }, [conversation, studioTasks]);

  const createStudioTask = useCallback(async () => {
    const task = await studioTasks.createTask({ title: "New conversation", taskType: "general" });
    if (!task?.conversationId) return;
    conversation.selectConversation(task.conversationId);
    await conversation.loadMessages(task.conversationId);
  }, [conversation, studioTasks]);

  const closeStudioTask = useCallback(async (task: StudioTask) => {
    await studioTasks.closeTask(task.id);
  }, [studioTasks]);

  useEffect(() => {
    if (!conversation.busy) {
      void refreshTasks();
      return;
    }
    // Item 5a — a new run attaches its actionRunId to the conversation's
    // studio task server-side just after the send is accepted. Refresh
    // once the run is underway so the Activity panel can resolve the run
    // id (and read its persisted events) during the run, not only after.
    const timer = setTimeout(() => { void refreshTasks(); }, 4000);
    return () => clearTimeout(timer);
  }, [conversation.busy, refreshTasks]);

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
    const projectId = resolveStudioProjectId(searchParams.get("project"));
    if (projectId) params.set("project", projectId);
    params.delete("prompt");

  // Canonical: always tool=chat for the LiTT conversation surface.
    // Workspace stages (code/canvas/preview) get their own tool value.
    // The create destination (Image Studio et al) is deep-linkable via
    // ?creator=<mode> — the ONLY URL route into the creator surfaces.
    // Writing ?tool=image here would NOT round-trip: legacy creative
    // tool URLs normalize to the chat surface on load by design.
    if (destination === "create") {
      params.delete("tool");
      params.set("creator", createMode);
    } else if (destination === "studio" && studioShellActive && workSurface !== "builder") {
      // Shell: the URL names the station the center actually renders.
      params.set("tool", stationToToolParam(stageSurface));
      params.delete("creator");
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
  }, [destination, studioMode, createMode, moreMode, workSurface, pathname, router, studioShellActive, stageSurface]);

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
        // Meaningful task names: the first accepted prompt names the
        // task — kills the "Untitled N" tab explosion. Only renames
        // auto-titled tasks; user-named tasks are untouched.
        const execTaskId = useExecutionStore.getState().activeTaskId;
        const activeTask = studioTasks.tasks.find((t) => t.id === execTaskId);
        if (activeTask) {
          const current = activeTask.title?.trim() ?? "";
          if (!current || /^untitled/i.test(current) || current === "New task") {
            const derived = value.trim().replace(/\s+/g, " ").slice(0, 60);
            if (derived) void studioTasks.updateTask(activeTask.id, { title: derived });
          }
        }
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
          } else if (studioShellActive) {
            // Shell: expand the LiTT layer so the approval card is visible.
            setLittExpanded(true);
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
          // The golden path ends with the user looking at the result, not
          // just a "Done" card — when the run finished with a live preview,
          // switch the workspace surface to it automatically.
          if (previewReady) {
            setDestination("studio");
            setStudioMode("preview");
            // Shell: the live preview takes the stage.
            if (studioShellActive) openStageSurface("preview");
          }
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
  }, [conversation, capabilities.projectId, refreshCapabilities, isMobileLitt, studioShellActive, openStageSurface, studioTasks]);

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
    /** Whether the approval decision reached the server (see approval-polling). */
    decisionRecorded?: boolean;
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
      // The approval POST failed or the resumed run failed afterwards.
      // decisionRecorded tells the store whether the gate is dead (run
      // executed and failed → clear Approve/Reject, phase "failed") or
      // still pending (POST never landed → card stays mounted with the
      // error and a true retry). An expiry failure keeps the card too, but
      // retry re-requests a fresh gate instead of re-POSTing the dead
      // pausedRunId.
      exec.failApproval(opts.runError, opts.retryable, { expired: opts.expired, decisionRecorded: opts.decisionRecorded });
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
            decisionRecorded: info?.decisionRecorded,
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
  }, [conversation, applyApprovalOutcome]);

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
          // The watcher only observes post-decision states: a failed
          // runStatus means the decision was recorded, so the gate is dead.
          decisionRecorded: outcome.runStatus === "failed" ? true : undefined,
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
      // Rebind the chat to the NEW project synchronously, before the router
      // settles: the old conversation stays selected otherwise and the first
      // message goes to a conversation that belongs to the previous project
      // ("Project mismatch"). Mirrors handleSelectProject's reset.
      useConversationStore.getState().resetForProject();
      // Update URL with project ID — and clear the stale conversation +
      // agent-instance params so nothing can re-bind to the old chat.
      const params = new URLSearchParams(searchParams.toString());
      params.set("project", project.id);
      params.delete("conversation");
      params.delete("agentInstance");
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
    if (studioShellActive) {
      openStageSurface("preview");
      return;
    }
    setDestination("studio");
    setStudioMode("preview");
  }, [studioShellActive, openStageSurface]);
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

  // ── F1: Worktabs — shell UI over the DURABLE server task model ────
  // Tabs ARE server tasks (GET/POST/PATCH /api/studio/tasks via
  // useStudioTasks, defined above — the runtime lane owns that API; the
  // shell consumes it as-is). The bar binds each task to a conversation +
  // a workspace surface + an ask-litt selection. Switching never stops an
  // in-flight run: chat fetch streams and execution SSE live in
  // shell-level stores/hooks keyed by conversationId/taskId, and
  // selectConversation + loadMessages never touch the send
  // AbortController. Closing a tab closes the server task (status=closed,
  // reopenable via the ↺ affordance) — the server-side conversation is
  // never deleted.
  // Encoded workspace surface — declared BEFORE the worktab views because
  // a task without a recorded surface inherits the shell's current one.
  // Encoded workspace surface, e.g. "studio/preview" | "create/image".
  // The Builder is dynamic work-surface state inside studio/work (not a
  // destination of its own) — it is encoded as a ":builder" suffix so tab
  // restores never eject it (or drag it onto a conversation tab).
  const currentSurface = useMemo(
    () =>
      destination === "studio"
        ? `studio/${studioMode}${studioMode === "work" ? `:${workSurface}` : ""}`
        : destination === "create"
          ? `create/${createMode}`
          : `${destination}/`,
    [destination, studioMode, createMode, workSurface],
  );

  const serverTasks = studioTasks.tasks;
  const serverActiveTaskId = studioTasks.activeTaskId;
  const projectDisplayName = capabilities.projectName?.trim() || "New conversation";

  // Keep stale placeholder rows recoverable on the server, but do not make
  // a new user stare at inherited "Untitled N" / "Current work" tabs. The
  // active row is retained so its conversation remains bound; the existing
  // send path renames it as soon as the user provides a real request.
  const visibleServerTasks = useMemo(() => {
    const meaningful = serverTasks.filter((task) => !isPlaceholderTaskTitle(task.title));
    const active = serverTasks.find((task) => task.id === serverActiveTaskId);
    if (meaningful.length === 0) return active ? [active] : serverTasks.slice(0, 1);
    if (active && !meaningful.some((task) => task.id === active.id)) return [active, ...meaningful];
    return meaningful;
  }, [serverActiveTaskId, serverTasks]);

  const worktabTabs = useMemo<Worktab[]>(
    () =>
      visibleServerTasks.map((t) =>
        mapStudioTaskToWorktab(t, {
          // Server truth first; a task that never recorded a surface
          // inherits the shell's current one (persisted on next switch).
          surface: t.lastOpenedSurface || currentSurface,
          selection: worktabSelections[t.id] ?? null,
          fallbackTitle: projectDisplayName,
        }),
      ),
    [visibleServerTasks, worktabSelections, currentSurface, projectDisplayName],
  );
  const activeWorktabId = serverActiveTaskId;
  const activeWorktab = worktabTabs.find((t) => t.id === activeWorktabId) ?? null;

  // Keep the execution store's conversation→task index fed from server
  // truth, so SSE events attribute to the OWNING tab even while another
  // tab is active (background runs keep their own badge).
  useEffect(() => {
    useExecutionStore.getState().setTaskConversationIndex(serverTasks);
  }, [serverTasks]);

  const restoreWorktabSurface = useCallback((surface: string) => {
    const sep = surface.indexOf("/");
    const dest = (sep === -1 ? surface : surface.slice(0, sep)) as StudioDestination;
    let mode = sep === -1 ? "" : surface.slice(sep + 1);
    // Optional ":workSurface" suffix for studio/work (builder vs conversation).
    let work: string | null = null;
    const colon = mode.indexOf(":");
    if (colon !== -1) {
      work = mode.slice(colon + 1);
      mode = mode.slice(0, colon);
    }
    if (dest === "studio" && mode) {
      setDestination("studio");
      setStudioMode(mode as StudioMode);
      // Restore the dynamic work surface. Without this a Builder tab
      // restore would eject back to the conversation view (or a stale
      // Builder would linger on a conversation tab).
      if (work === "builder" || work === "conversation") {
        setWorkSurface(work as WorkSurface);
      }
    } else if (dest === "create" && mode) {
      setCreateMode(mode as CreateMode);
      setDestination("create");
    } else if (dest) {
      setDestination(dest);
    }
  }, []);

  // Store action via selector (not getState) so this also works wherever the
  // store is a thin mock — the action is stable in the real zustand store.
  const selectConversationAction = useConversationStore((s) => s.selectConversation);

  const bindWorktab = useCallback((tab: Worktab) => {
    if (tab.conversationId) {
      handleSelectConversation(tab.conversationId);
    } else {
      // Fresh tab — clear the selection; the canonical controller lazily
      // provisions a conversation on first send (no new conversation API).
      selectConversationAction(null);
    }
    restoreWorktabSurface(tab.surface);
    // Restore the tab's ask-litt selection into the composer chip line —
    // the full payload, so the next send carries it to the LLM.
    setPreviewSelection(tab.selection);
  }, [handleSelectConversation, restoreWorktabSurface, selectConversationAction]);

  const handleSwitchWorktab = useCallback((id: string) => {
    const task = serverTasks.find((t) => t.id === id);
    if (!task || id === serverActiveTaskId) return;
    // F1: execution events attribute per-task; keep the active task id in
    // sync so the per-task phase mirror tracks the visible tab.
    useExecutionStore.getState().setActiveTaskId(id);
    const view = worktabTabs.find((t) => t.id === id);
    // PATCH lastOpenedSurface (server truth for restores) + lastOpenedAt,
    // then bind the tab's conversation/surface/selection.
    void studioTasks.activateTask(id, view?.surface ?? currentSurface);
    if (view) bindWorktab(view);
    // Shell: the task-change effect restores this task's stage surface.
  }, [serverTasks, serverActiveTaskId, worktabTabs, bindWorktab, currentSurface, studioTasks]);

  const handleNewWorktab = useCallback(async () => {
    const task = await studioTasks.createTask({
      title: "New conversation",
      taskType: "general",
    });
    if (!task) return;
    useExecutionStore.getState().setActiveTaskId(task.id);
    // Fresh task: no conversation yet (the canonical controller lazily
    // provisions one on first send); bind clears the selection and
    // restores the current surface.
    bindWorktab(
      mapStudioTaskToWorktab(task, { surface: currentSurface, selection: null, fallbackTitle: projectDisplayName }),
    );
    // Shell: a fresh task opens the LiTT command layer — it's where the
    // task gets its first prompt (which also names the task).
    if (studioShellActive) setLittExpanded(true);
  }, [studioTasks, bindWorktab, currentSurface, projectDisplayName, studioShellActive]);

  const handleCloseWorktab = useCallback(async (id: string) => {
    const idx = serverTasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const wasActive = id === serverActiveTaskId;
    const closedSurface = serverTasks[idx].lastOpenedSurface || currentSurface;
    const ok = await studioTasks.closeTask(id);
    if (!ok) return;
    // Closing a background tab leaves the active tab untouched.
    if (!wasActive) return;
    const remaining = serverTasks.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      // Never leave zero tabs — seed a fresh server task. The closed
      // task's conversation stays on the server (close, never delete).
      // Use an explicit first-run label; implementation-generated numbered
      // placeholders must never become visible user identity.
      const task = await studioTasks.createTask({
        title: "New conversation",
        taskType: "general",
      });
      if (task) {
        useExecutionStore.getState().setActiveTaskId(task.id);
        bindWorktab(
          mapStudioTaskToWorktab(task, { surface: closedSurface, selection: null, fallbackTitle: projectDisplayName }),
        );
      }
      return;
    }
    // Re-bind the neighbor tab (same index rule as a tab strip).
    const next = remaining[Math.min(idx, remaining.length - 1)];
    const view = mapStudioTaskToWorktab(next, {
      surface: next.lastOpenedSurface || currentSurface,
      selection: worktabSelections[next.id] ?? null,
      fallbackTitle: projectDisplayName,
    });
    useExecutionStore.getState().setActiveTaskId(next.id);
    void studioTasks.activateTask(next.id, view.surface);
    bindWorktab(view);
  }, [serverTasks, serverActiveTaskId, currentSurface, worktabSelections, bindWorktab, projectDisplayName, studioTasks]);

  const handleReopenWorktab = useCallback(async (id: string) => {
    const task = await studioTasks.reopenTask(id);
    if (!task) return;
    const view = mapStudioTaskToWorktab(task, {
      surface: task.lastOpenedSurface || currentSurface,
      selection: worktabSelections[task.id] ?? null,
      fallbackTitle: projectDisplayName,
    });
    useExecutionStore.getState().setActiveTaskId(task.id);
    bindWorktab(view);
  }, [studioTasks, currentSurface, worktabSelections, bindWorktab, projectDisplayName]);

  // Clearing the selection (composer chip × or legacy strip) clears both
  // the active tab's pinned selection and the preview-selection mirror.
  const handleClearWorktabSelection = useCallback(() => {
    const id = useExecutionStore.getState().activeTaskId;
    if (id) setWorktabSelection(id, null);
    setPreviewSelection(null);
  }, [setWorktabSelection]);

  // First load per project: bind the active server task (restores its
  // conversation + surface + ask-litt selection) once the task list has
  // loaded. Runs once — later active-task changes go through the
  // switch/close/reopen handlers above, so this never yanks the tab.
  const initialBindProjectRef = useRef<string | null>(null);
  useEffect(() => {
    const projectId = capabilities.projectId;
    if (!projectId || studioTasks.loading) return;
    if (initialBindProjectRef.current === projectId) return;
    initialBindProjectRef.current = projectId;
    const tab = worktabTabs.find((t) => t.id === serverActiveTaskId) ?? worktabTabs[0] ?? null;
    // No tasks yet — the bar shows [+] until the user starts real work.
    if (!tab) return;
    if (serverActiveTaskId !== tab.id) studioTasks.setActiveTaskId(tab.id);
    useExecutionStore.getState().setActiveTaskId(tab.id);
    bindWorktab(tab);
  }, [capabilities.projectId, studioTasks, worktabTabs, serverActiveTaskId, bindWorktab]);

  // (Deleted — Phase 3: the old "track the active tab's surface" writer.
  //  It raced the surface→task effect below with a different vocabulary
  //  (encoded workspace surface vs shell stage surface), so each PATCH
  //  re-triggered the other: infinite PATCH oscillation. There is now
  //  exactly one persist effect; see below.)

  // The runtime auto-adopts a freshly provisioned conversation into a new
  // server task (auto-seed effect above). When that new task supersedes
  // the empty [+] tab it was born from, close the empty tab so stray
  // "Untitled" tabs don't accumulate. Tight guards: only a just-created
  // (<15s), conversation-bound task taking over from an empty
  // previously-active tab — manual switches to older tabs never trigger.
  const prevActiveTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevActiveTaskIdRef.current;
    const activeId = serverActiveTaskId;
    prevActiveTaskIdRef.current = activeId;
    if (!prevId || prevId === activeId || !activeId) return;
    const next = serverTasks.find((t) => t.id === activeId);
    const prev = serverTasks.find((t) => t.id === prevId);
    if (!next || !prev) return;
    if (prev.conversationId !== null) return;
    if (next.conversationId !== conversation.selectedConversationId) return;
    const ageMs = Date.now() - Date.parse(next.createdAt);
    if (Number.isNaN(ageMs) || ageMs > 15000) return;
    void studioTasks.closeTask(prev.id);
  }, [serverActiveTaskId, serverTasks, conversation.selectedConversationId, studioTasks]);

  // F1: per-worktab status badges — derived ONLY from the execution store
  // (per-task phases, SSE-fed real states) and the server action-run
  // projection. Never optimistic: "ready" requires real completion
  // evidence; unknown tabs read "idle".
  const worktabBadges = useWorktabBadges(worktabTabs);

  // ── StudioShell ↔ durable task binding ─────────────────────────────
  // Task → surface: switching the active worktab restores that task's
  // remembered stage surface (server `lastOpenedSurface` is the truth).
  // Runs BEFORE the persist effect below so a task switch never
  // overwrites the new task's stored surface.
  const lastSyncedTaskRef = useRef<string | null>(null);
  const didInitialTaskSyncRef = useRef(false);
  useEffect(() => {
    if (!studioShellActive) return;
    if (serverActiveTaskId === lastSyncedTaskRef.current) return;
    lastSyncedTaskRef.current = serverActiveTaskId;
    const isFirstSync = !didInitialTaskSyncRef.current;
    didInitialTaskSyncRef.current = true;
    const task = serverTasks.find((t) => t.id === serverActiveTaskId);
    // First load: an explicit ?tool= deep link beats the remembered
    // surface (acceptance: tool=preview rendered the stale "plan" surface).
    const urlStation = isFirstSync ? toolParamToStation(searchParams.get("tool")) : null;
    const mapped = urlStation ?? centerStation(resolveStageSurface(task?.lastOpenedSurface));
    setStageSurface((current) => (current === mapped ? current : mapped));
    setMountedSurfaces((prev) => (prev.has(mapped) ? prev : new Set(prev).add(mapped)));
    // searchParams is read only on the first sync — deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioShellActive, serverActiveTaskId, serverTasks]);

  // Phase 3 — SINGLE authoritative surface-persist path. A user-initiated
  // surface switch persists onto the active server task (server truth for
  // restores). This is the only automatic writer of lastOpenedSurface:
  // the canonical value and the in-sync guard both live in
  // canonicalSurfaceToPersist(), and persistSurface() itself no-ops when
  // the server value already matches — so no PATCH oscillation and no
  // surface loops are possible by construction.
  useEffect(() => {
    const id = serverActiveTaskId;
    if (!capabilities.projectId || !id || studioTasks.loading) return;
    const task = serverTasks.find((t) => t.id === id);
    if (!task) return;
    const toPersist = canonicalSurfaceToPersist({
      shellActive: studioShellActive,
      stageSurface,
      currentSurface,
      storedSurface: task.lastOpenedSurface,
    });
    if (toPersist === null) return;
    void studioTasks.persistSurface(id, toPersist);
  }, [studioShellActive, stageSurface, currentSurface, serverActiveTaskId, serverTasks, capabilities.projectId, studioTasks]);

  // An approval gate must never strand hidden: a paused run expands the
  // LiTT command layer so the approve/reject decision stays reachable.
  useEffect(() => {
    if (!studioShellActive || !pendingApproval) return;
    setLittExpanded(true);
  }, [studioShellActive, pendingApproval]);

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
  const mobileSurface: MobileStudioSurface | null = mobileToolsOpen
    ? "more"
    : mobileLittOpen
      ? (littActiveTab === "live" ? "activity" : "chat")
      : contextDrawerOpen && contextDrawerTab === "files"
        ? "files"
        : isPreview
          ? "preview"
          : null;
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

  // Error + approval chrome rendered inside the LiTT command layer's
  // transcript (and the mobile sheet / classic panel via littChatContent).
  const chatErrorBanner = (conversation.requiresReauth || conversation.sendError || projectCreateError) ? (
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
  ) : null;

  const chatApprovalCard = pendingApproval ? (
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
  ) : null;

  // The LiTT command layer: transcript region (expanded) + composer bar
  // (always visible). Shared with the mobile sheet / classic panel paths
  // via littChatContent = transcript + composer.
  const littTranscript = (
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
        suppressEmptyState={
          isOnboardingComplete(userId, activeProjectId) || Boolean(composerValue.trim())
        }
        // Canonical runtime truth: the visible PTY is interactive right now.
        ptyUsable={runtime?.terminal?.usable ?? false}
        onContinueCompletion={() => {
          const textarea = document.querySelector<HTMLTextAreaElement>("[data-testid='studio-command-composer'] textarea");
          textarea?.focus();
          setCompletion(null);
        }}
      />
      {chatErrorBanner}
      {/* Approval gate — pinned directly above the composer so the
          approve/deny decision is always one glance away. Deploy
          approvals are visually distinct: project.deploy always
          requires a human, even in AUTO. */}
      {chatApprovalCard}
    </>
  );

  const littComposer = (
    <>
      {/* Browser session chip — above the composer so takeover state is
          visible whether the LiTT layer is collapsed or expanded. */}
      <StudioBrowserStatusChip
        conversationId={conversation.selectedConversationId ?? undefined}
        active={conversation.busy}
      />
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
        // F1: the ACTIVE worktab's ask-litt selection drives the structured
        // context chips (Slice B). Legacy preview-click selections still
        // flow through contextLine.selectedElement as fallback.
        selection={activeWorktab?.selection ?? null}
        onClearSelectionItem={handleClearWorktabSelection}
        onClearSelectedElement={handleClearWorktabSelection}
        executionMode={executionMode}
        onExecutionModeChange={setExecutionMode}
        executionHint={executionHint}
      />
    </>
  );

  // Classic + mobile surfaces render transcript and composer together.
  const littChatContent = (
    <>
      {littTranscript}
      {littComposer}
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

  // The run-state strip (StudioOperatorBar) — shared VERBATIM between the
  // bottom command layer and the left dock panel. Pure relocation: no
  // logic, handler, or prop changes. Approval behavior is owned by the
  // separate approval-fix lane.
  const operatorBar = (
    <StudioOperatorBar
      onOpenTerminal={() => openStageSurface("terminal")}
      onOpenActivity={() => openStageSurface("activity")}
      onRollback={handleRollback}
      onStop={() => {
        conversation.cancel();
        useExecutionStore.getState().endRun("cancelled");
      }}
      onResolveApproval={handleResolveApproval}
      terminalStatus={terminalHealthOf(capabilities).label}
      modelLabel={modelLabel}
    />
  );

  // Left-dock chat column: transcript (scrolls) + operator bar + composer
  // pinned to the panel bottom. littTranscript (which already contains the
  // in-conversation ApprovalCard) and littComposer move as whole elements —
  // nothing inside them is edited here.
  const littLeftPanelContent = (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-testid="litt-dock-transcript"
      >
        {littTranscript}
      </div>
      {operatorBar}
      <div
        className="shrink-0 border-t px-1 pb-1 pt-1"
        style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
        data-testid="litt-dock-composer"
      >
        {littComposer}
      </div>
    </>
  );

  // ── Stage surface content — the shell's central Stage renders the
  // active workspace surface for the active task. Visited surfaces stay
  // mounted (hidden) so preview iframes, PTY sessions, files, and canvas
  // state survive switching. Render-scoped, not memoized.
  const renderStageSurface = (surface: StudioStageSurface, active: boolean) => {
    const projectId = capabilities.projectId;
    switch (surface) {
      case "plan":
        return (
          <StudioPlanSurface
            capabilities={capabilities}
            modelLabel={modelLabel}
            onOpenCode={() => openStageSurface("code")}
            onOpenCanvas={() => openStageSurface("design")}
            onOpenPreview={() => openStageSurface("preview")}
            onOpenTerminal={() => openStageSurface("terminal")}
            onOpenActivity={() => openStageSurface("activity")}
            onOpenFiles={handleOpenContextFiles}
            onRollback={handleRollback}
          />
        );
      case "design":
        return <VisualCanvasBuilder />;
      case "preview":
        return (
          <StudioPreviewPanel
            projectId={projectId}
            projectName={capabilities.projectName}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch}
            sourceKind={capabilities.sourceKind}
            sourceStatus={capabilities.sourceStatus}
            versionControl={capabilities.versionControl}
            workspaceStatus={capabilities.workspaceStatus ?? null}
            onSelectionChange={setPreviewSelection}
          />
        );
      case "browser":
        return <StudioBrowserJobsPanel projectId={projectId} conversationId={conversation.selectedConversationId} />;
      case "code":
        return (
          <CodeWorkspace
            projectId={capabilities.projectId}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch}
            workspaceStatus={capabilities.workspaceStatus ?? null}
            writeAccess={capabilities.writeAccess ?? true}
          />
        );
      case "files":
        return (
          <StudioProjectFiles
            projectId={projectId}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch ?? capabilities.defaultBranch}
            workspaceStatus={capabilities.workspaceStatus}
            writeAccess={capabilities.writeAccess}
            onSaved={() => setWorkspaceRevision((value) => value + 1)}
            onMutation={() => setWorkspaceRevision((value) => value + 1)}
            onWorkspacePrepared={() => { void refreshCapabilities(); }}
          />
        );
      case "images":
        return (
          <ImageStudio
            projectId={projectId}
            onOpenCreate={() => { setCreateMode("image"); setDestination("create"); }}
          />
        );
      case "assets":
        return <AssetsPanel projectId={projectId} />;
      case "deploy":
        return (
          <StudioDeploySurface
            projectId={projectId}
            onDeployRequest={() => {
              window.dispatchEvent(new CustomEvent(STUDIO_EVENT_REQUEST_DEPLOY));
            }}
          />
        );
      case "activity":
        return (
          <StudioActivityPanel
            runId={activityRunId}
            busy={conversation.busy}
            modelLabel={modelLabel}
            projectName={capabilities.projectName}
            terminalStatus={terminalHealthOf(capabilities).label}
            missionContent={
              <MissionCards
                capabilities={capabilities}
                modelLabel={modelLabel}
                onOpenCode={() => openStageSurface("code")}
                onOpenCanvas={() => openStageSurface("design")}
                onOpenPreview={() => openStageSurface("preview")}
                onOpenTerminal={() => openStageSurface("terminal")}
                onOpenActivity={() => openStageSurface("activity")}
                onOpenFiles={() => openStageSurface("files")}
                onRollback={handleRollback}
              />
            }
          />
        );
      case "terminal":
        return (
          <StudioTerminalDrawer
            projectId={projectId}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch ?? capabilities.defaultBranch}
            visible={active}
          />
        );
      default:
        return null;
    }
  };

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
        // Map the F1 selection value (legacy shape or full payload) onto
        // the preview-selection mirror that drives the composer chips.
        if (!next) {
          setPreviewSelection(null);
          return;
        }
        const label = next.label ?? next.content ?? next.elementId ?? "selection";
        setPreviewSelection({
          label,
          selector: next.selector ?? next.elementId ?? label,
          tagName: next.tagName ?? next.componentName ?? "element",
        });
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

        {/* Body: LiTT rail | Workspace — canvas-first 2-zone layout.
            - LiTTPanel never reserves a permanent desktop column (F1):
              collapsed it is the 64px ambient HUD rail in flow; expanded
              it is Slice B's floating overlay panel (fixed, right side).
            - The workspace <main> is the canvas zone: the WorktabBar sits
              directly above it, then Design / Code / Preview consume ALL
              remaining width. No permanent secondary columns are reserved.
            - Files, Terminal, Inspector, Assets, Media live in the
              toggleable bottom StudioDock; advanced tools open as
              drawers/sheets/overlays.
            Mobile behavior is unchanged: ContextDrawer is a right-side fixed
            overlay, LiTTPanel is a mobile sheet, Preview is a workspace tab. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-studio-body>
        {studioShellActive ? (
          <StudioShell
            taskbar={
              /* Durable worktabs — task identity, never layout. */
              <WorktabBar
                tabs={worktabTabs}
                activeId={activeWorktabId}
                badges={worktabBadges}
                onSwitch={handleSwitchWorktab}
                onClose={(id) => { void handleCloseWorktab(id); }}
                onNew={() => { void handleNewWorktab(); }}
                closedTabs={studioTasks.closedTasks.map((t) => ({
                  id: t.id,
                  title: displayWorktabTitle(t.title, projectDisplayName),
                }))}
                onReopen={(id) => { void handleReopenWorktab(id); }}
              />
            }
            rail={
              <WorkspaceRail
                active={stageSurface}
                onSelect={openStageSurface}
              />
            }
            stage={
              <>
                {Array.from(
                  mountedSurfaces.has(stageSurface)
                    ? mountedSurfaces
                    : new Set([...mountedSurfaces, stageSurface]),
                ).map((surface) => {
                  const active = surface === stageSurface;
                  return (
                    <div
                      key={surface}
                      // `hidden` attribute would lose to Tailwind's `flex`
                      // display utility — toggle the class instead.
                      className={active
                        ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                        : "hidden"}
                      data-testid={`stage-surface-${surface}`}
                      data-active={active ? "true" : "false"}
                    >
                      {renderStageSurface(surface, active)}
                    </div>
                  );
                })}
              </>
            }
            inspector={
              <ContextInspector
                open={inspectorOpen}
                onToggle={() => setInspectorOpen((v) => !v)}
                selection={
                  activeWorktab?.selection
                    ? {
                        label: activeWorktab.selection.label,
                        tagName: activeWorktab.selection.tagName,
                        sourceFile: activeWorktab.selection.sourceFile,
                        route: activeWorktab.selection.route,
                      }
                    : previewSelection
                      ? { label: previewSelection.label, tagName: previewSelection.tagName }
                      : null
                }
                onAskAboutSelection={() => {
                  const sel: StudioSelectionPayload | null = activeWorktab?.selection
                    ?? (previewSelection && capabilities.projectId
                      ? {
                          kind: "preview-element",
                          label: previewSelection.label,
                          selector: previewSelection.selector,
                          tagName: previewSelection.tagName,
                          projectId: capabilities.projectId,
                          timestamp: Date.now(),
                        }
                      : null);
                  if (sel) {
                    window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: { selection: sel } }));
                  } else {
                    setLittExpanded(true);
                  }
                }}
                onClearSelection={handleClearWorktabSelection}
                editor={
                  // The real element-edit path — only when a live preview
                  // element is selected (builder nodes use
                  // propertiesContent below).
                  previewSelection && !builderSelectedNodeId ? (
                    <ElementInspectorPanel
                      selection={previewSelection}
                      projectId={capabilities.projectId}
                      route={null}
                      onAskAboutSelection={() => {
                        const sel: StudioSelectionPayload | null = activeWorktab?.selection
                          ?? (capabilities.projectId
                            ? {
                                kind: "preview-element",
                                label: previewSelection.label,
                                selector: previewSelection.selector,
                                tagName: previewSelection.tagName,
                                sourceFile: previewSelection.attrs?.["data-source"],
                                projectId: capabilities.projectId,
                                timestamp: Date.now(),
                              }
                            : null);
                        if (sel) {
                          window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: { selection: sel } }));
                        } else {
                          setLittExpanded(true);
                        }
                      }}
                      onClearSelection={handleClearWorktabSelection}
                    />
                  ) : undefined
                }
                propertiesContent={builderSelectedNodeId ? <BuilderPropertiesPanel /> : null}
                defaultContent={
                  <StudioInspector
                    embedded
                    open
                    onToggle={() => setInspectorOpen(false)}
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
                      conversationId: conversation.selectedConversationId,
                      workspaceRevision,
                      healthRunTrigger,
                      onFilesSaved: () => setWorkspaceRevision((value) => value + 1),
                      onWorkspacePrepared: () => { void refreshCapabilities(); },
                    }}
                  />
                }
              />
            }
            leftPanel={
              chatDock === "left" ? (
                <LiTTPanel
                  overlay={false}
                  collapsed={littCollapsed}
                  onCollapse={() => setLittCollapsed(true)}
                  onExpand={() => setLittCollapsed(false)}
                  activeTab={littActiveTab}
                  onTabChange={setLittActiveTab}
                  voiceConnected={liveSession.isLive}
                  microphoneStatus={liveSession.indicators.microphone}
                  chatContent={littLeftPanelContent}
                  liveContent={littLiveContent}
                  expandedWidth={littDockResize.width}
                  expandedMaxWidth="500px"
                  dockPosition="left"
                  onDockPositionChange={setChatDock}
                />
              ) : null
            }
            dockHandle={
              chatDock === "left" && !littCollapsed ? (
                <ResizeHandle
                  onDragStart={littDockResize.onDragStart}
                  onReset={littDockResize.reset}
                  isDragging={littDockResize.isDragging}
                  direction="left"
                  ariaLabel="Resize LiTT chat panel"
                  testId="litt-dock-resize"
                />
              ) : null
            }
            littLayer={
              chatDock === "left" ? null : (
                <LiTTCommandLayer
                  storageKey={capabilities.projectId ?? "default"}
                  busy={conversation.busy}
                  expanded={littExpanded}
                  onExpandedChange={setLittExpanded}
                  transcript={littTranscript}
                  composer={littComposer}
                  statusBar={operatorBar}
                  dockPosition="bottom"
                  onDockPositionChange={setChatDock}
                />
              )
            }
          />
        ) : (
          <>
            {/* Desktop ContextDrawer removed (P2): Files, Inspector, Activity,
              and the terminal now live in the bottom StudioDock, toggled
              from the top command bar. The mobile ContextDrawer overlay
              below is unchanged. */}

          {/* F1 workspace-first: LiTT never reserves a permanent desktop
              column. Collapsed → the 64px ambient HUD rail in flow
              (Slice B column mode). Expanded → Slice B's `overlay` mode:
              a floating panel (fixed, right side, elevated shadow) that
              hides with display:none when closed. One LiTTPanel instance
              at the same tree position, so chat content, SSE streams,
              scroll position, and composer drafts survive the toggle.
              Below 1024px, LiTT is NOT rendered here at all — it is
              accessed via the mobile trigger + overlay sheet below
              (Phase C2.1). */}
          {viewportTier !== null && !isMobileLitt && (
            <LiTTPanel
              overlay={!littCollapsed}
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
          )}

          <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden overflow-x-hidden">
            {/* F1 Worktabs — directly above the workspace. Each tab binds
                a conversation to a surface + ask-litt selection; the bar
                scrolls horizontally at narrow widths (390px-safe: the bar
                scrolls, the page never overflows). */}
            <WorktabBar
              tabs={worktabTabs}
              activeId={activeWorktabId}
              badges={worktabBadges}
              onSwitch={handleSwitchWorktab}
              onClose={(id) => { void handleCloseWorktab(id); }}
              onNew={() => { void handleNewWorktab(); }}
              closedTabs={studioTasks.closedTasks.map((t) => ({
                id: t.id,
                title: displayWorktabTitle(t.title, projectDisplayName),
              }))}
              onReopen={(id) => { void handleReopenWorktab(id); }}
            />
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
                     layout).
                     Phase 3B: Primary action bar above the preview. */
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden flex flex-col">
                    {primaryActionState !== "idle" && (
                      <div
                        className="shrink-0 border-b px-4 py-2.5 flex items-center justify-between"
                        style={{
                          borderColor: "var(--glass-border)",
                          backgroundColor: "var(--glass-bg)",
                        }}
                        data-testid="studio-primary-action-bar"
                      >
                        <StudioPrimaryAction
                          state={primaryActionState}
                          onDeploy={handleDeployRequest}
                          onFocusApproval={handleFocusApproval}
                        />
                      </div>
                    )}
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
                // MissionCards live in the dock Activity tab (classic
                // desktop topology) and in the shell's center `activity`
                // stage surface; mobile keeps the build-status sheet.
                <StudioActivityPanel
                  runId={activityRunId}
                  busy={conversation.busy}
                  modelLabel={modelLabel}
                  projectName={capabilities.projectName}
                  terminalStatus={terminalHealthOf(capabilities).label}
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
                    conversationId: conversation.selectedConversationId,
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
                    conversationId: conversation.selectedConversationId,
                    workspaceRevision,
                    healthRunTrigger,
                    onFilesSaved: () => setWorkspaceRevision((value) => value + 1),
                    onWorkspacePrepared: () => { void refreshCapabilities(); },
                  }}
                />
              }
            />
          )}
        </>
        )}
        </div>

        {/* Persistent music player — survives tool switches while audio plays */}
        <PersistentMusicPlayer />

        {/* Mobile work-surface dock — Chat / Preview / Files / Activity / More.
            All surfaces operate on the same mission, conversation, preview,
            browser, and execution stores as desktop. */}
        <MobileCommandNav
          active={destination}
          onSelect={handleSelectDestination}
          surface={mobileSurface}
          onSelectSurface={handleMobileSurface}
        />

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
            aria-label={conversation.busy ? "LiTT is working — open chat" : "Ask LiTT to build"}
            title={conversation.busy ? "LiTT is working" : "Ask LiTT to build"}
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
            {/* Running indicator — when the chat sheet is closed mid-run,
                this dot is the only signal that LiTT is still working.
                Real state only: bound to conversation.busy, not a timer. */}
            {conversation.busy && (
              <span
                className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2"
                style={{
                  backgroundColor: "var(--litt-primary)",
                  borderColor: "var(--studio-surface)",
                }}
                data-testid="litt-mobile-busy-dot"
                aria-hidden
              />
            )}
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
              tasks={studioTasks.tasks}
              activeTaskId={studioTasks.activeTaskId}
              onSelectTask={(task) => { void activateStudioTask(task); setMobileToolsOpen(false); }}
              onCreateTask={() => { void createStudioTask(); setMobileToolsOpen(false); }}
              onCloseTask={(task) => { void closeStudioTask(task); }}
              closedTasks={studioTasks.closedTasks}
              onReopenTask={(task) => { void studioTasks.reopenTask(task.id); setMobileToolsOpen(false); }}
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
  projectId: _projectId,
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
  ptyUsable = false,
  suppressEmptyState = false,
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
  /** Canonical runtime truth: is the interactive PTY usable right now. */
  ptyUsable?: boolean;
  suppressEmptyState?: boolean;
}) {
  const isEmpty = messages.length === 0 && !loading && !suppressEmptyState;
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
      {conversationId && <ChatBrowserLiveView conversationId={conversationId} />}
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
          // Canonical runtime truth — the ONLY consumer path for PTY
          // usability outside useProjectRuntime itself.
          ptyUsable={ptyUsable}
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
