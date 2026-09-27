"use client";

/**
 * Studio shell — the single source of truth for the Figma-like operating shell.
 *
 * Owns: project capabilities, named tasks (via the F1 /api/studio/tasks
 * model), the one selection model, the active workspace, the inspector and
 * command-deck chrome state, and the canonical conversation controller.
 *
 * The shell DIRECTLY replaces the old CommandStudio layout: nothing floats,
 * tasks never get "Untitled N", and the deck is docked — not an overlay.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useStudioTasks } from "../hooks/useStudioTasks";
import { useCanonicalConversation } from "../hooks/useCanonicalConversation";
import { useConversationStore } from "../stores/useConversationStore";
import { useExecutionStore } from "../stores/useExecutionStore";
import { StudioContextProvider } from "../context/StudioContext";
import type { InspectorTab } from "../lib/studio-destinations";
import type { StudioTask } from "@/lib/studio/task-types";
import type { StudioTool } from "../lib/studio-destinations";
import { deriveTaskTitle, isPlaceholderTitle, surfaceToWorkspace } from "./task-naming";

export type WorkspaceId =
  | "design"
  | "browser"
  | "images"
  | "code"
  | "files"
  | "assets"
  | "deploy"
  | "activity";

export type SelectionKind = "element" | "file" | "image" | "browser-tab" | "task";

/**
 * The ONE selection model. { workspace, kind, ref, label } drives the
 * inspector, the deck's selection chip, and LiTT's request context.
 */
export interface SelectedObject {
  workspace: WorkspaceId;
  kind: SelectionKind;
  /** selector / file path / image id / tab id / task id */
  ref: string;
  label: string;
  tagName?: string;
}

export type DeckTab = "chat" | "live";
export type MobileTab = "workspace" | "litt" | "panels";

/** A real media-generator request: the Images workspace mounts the actual tool. */
export interface MediaRequest {
  kind: "image" | "video";
  prompt: string;
}

/** Which StudioHealthPanel view the Activity workspace should show, if any. */
export interface HealthPanelRequest {
  mode: "checks" | "approvals";
  runTrigger: number;
}

function workspaceToSurface(workspace: WorkspaceId): string {
  return workspace === "design" ? "preview" : workspace;
}

interface StudioShellValue {
  /** Project capabilities (projectId, projectName, terminal status, …). */
  capabilities: ReturnType<typeof useConnectionSummary>["capabilities"];
  capabilitiesLoading: boolean;

  // ── Named tasks ──────────────────────────────────────────────
  tasks: StudioTask[];
  closedTasks: StudioTask[];
  tasksLoading: boolean;
  activeTaskId: string | null;
  activeTask: StudioTask | null;
  selectTask: (taskId: string) => Promise<void>;
  createNewTask: () => Promise<StudioTask | null>;
  renameTask: (taskId: string, title: string) => Promise<StudioTask | null>;
  closeTask: (taskId: string) => Promise<boolean>;

  // ── Workspace ────────────────────────────────────────────────
  workspace: WorkspaceId;
  selectWorkspace: (workspace: WorkspaceId) => void;

  // ── Selection ────────────────────────────────────────────────
  selection: SelectedObject | null;
  setSelection: (selection: SelectedObject | null) => void;
  clearSelection: () => void;

  // ── Conversation / composer ──────────────────────────────────
  conversation: ReturnType<typeof useCanonicalConversation>;
  composerValue: string;
  setComposerValue: (value: string) => void;
  sendMessage: (value: string, attachments?: string[]) => Promise<unknown>;
  /** Prefill the composer with a selection-scoped instruction (inspector edits route through LiTT). */
  applyInspectorEdit: (instruction: string) => void;

  // ── Deck chrome ─────────────────────────────────────────────
  deckCollapsed: boolean;
  setDeckCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  deckExpanded: boolean;
  setDeckExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  deckTab: DeckTab;
  setDeckTab: (tab: DeckTab) => void;

  // ── Inspector chrome ─────────────────────────────────────────
  inspectorCollapsed: boolean;
  setInspectorCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  inspectorWidth: number;
  setInspectorWidth: React.Dispatch<React.SetStateAction<number>>;

  // ── Mobile ───────────────────────────────────────────────────
  mobileTab: MobileTab;
  setMobileTab: React.Dispatch<React.SetStateAction<MobileTab>>;

  // ── Media generator (real Image/Video tools, not a placeholder) ──
  mediaRequest: MediaRequest | null;
  clearMediaRequest: () => void;

  // ── Health/approvals panel ───────────────────────────────────────
  healthPanel: HealthPanelRequest | null;

  // ── Blank-project dialog ─────────────────────────────────────────
  projectNameDialogOpen: boolean;
  setProjectNameDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  creatingProject: boolean;
  projectCreateError: string | null;
  startBlankProject: (name: string) => Promise<void>;
}

const StudioShellContext = createContext<StudioShellValue | null>(null);

export function useStudioShell(): StudioShellValue {
  const value = useContext(StudioShellContext);
  if (!value) throw new Error("useStudioShell must be used inside StudioShellProvider");
  return value;
}

/**
 * Map a legacy tool id to a shell workspace. Every tool resolves to a REAL
 * action — a workspace switch or the deck — never a silent no-op. Tools with
 * no Phase-1 surface (camera, screen, plugins, agents, canvas, …) land on
 * the deck chat, where the assistant's message stays visible and the
 * conversation continues.
 */
function routeToolToWorkspace(tool: StudioTool): WorkspaceId | null {
  const id = tool.toLowerCase();
  if (/preview|design|website|site/.test(id)) return "design";
  if (/browser/.test(id)) return "browser";
  if (/image|media|video|audio|music/.test(id)) return "images";
  if (/code|edit|file/.test(id)) return "code";
  if (/deploy|publish/.test(id)) return "deploy";
  if (/activity|log/.test(id)) return "activity";
  // build/canvas have no dedicated workspace yet — the design surface is
  // where building happens.
  if (/build|canvas/.test(id)) return "design";
  return null;
}

export function StudioShellProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { getToken, userId } = useClerkAuth();
  const { capabilities, loading: capabilitiesLoading, refresh: refreshCapabilities } =
    useConnectionSummary();
  const projectId = capabilities.projectId;

  const [workspace, setWorkspaceState] = useState<WorkspaceId>("design");
  const [selection, setSelection] = useState<SelectedObject | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [deckCollapsed, setDeckCollapsed] = useState(false);
  const [deckExpanded, setDeckExpanded] = useState(false);
  const [deckTab, setDeckTab] = useState<DeckTab>("chat");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(300);
  const [mobileTab, setMobileTab] = useState<MobileTab>("workspace");
  const [mediaRequest, setMediaRequest] = useState<MediaRequest | null>(null);
  const [healthPanel, setHealthPanel] = useState<HealthPanelRequest | null>(null);
  const [projectNameDialogOpen, setProjectNameDialogOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null);

  const studioTasks = useStudioTasks(projectId);
  // Latest task data for callbacks (updated post-render so callbacks never
  // close over stale task state).
  const tasksRef = useRef(studioTasks.tasks);
  const activeTaskRef = useRef<StudioTask | null>(null);
  useEffect(() => {
    tasksRef.current = studioTasks.tasks;
    activeTaskRef.current = studioTasks.activeTask;
  });

  // The single conversation controller.
  const conversation = useCanonicalConversation({
    serverProjectId: searchParams.get("project") ?? projectId,
    capabilities,
    previewSelection: selection?.kind === "element"
      ? { label: selection.label, selector: selection.ref, tagName: selection.tagName ?? "" }
      : null,
    onRouteToolAction: (tool) => {
      // The shell has no terminal drawer in Phase 1 — "terminal" opens the
      // deck's Live tab, the shell's real execution surface. Tools with no
      // workspace land on the deck chat (never a silent no-op).
      if (tool === "terminal") {
        setDeckCollapsed(false);
        setDeckTab("live");
        setMobileTab("litt");
        return;
      }
      const target = routeToolToWorkspace(tool);
      if (target) {
        setWorkspaceState(target);
        return;
      }
      setDeckCollapsed(false);
      setDeckExpanded(true);
      setDeckTab("chat");
      setMobileTab("litt");
    },
    onRouteInspectorAction: (tab: InspectorTab) => {
      // The old tabbed inspector is gone; every tab maps to an honest
      // shell target — never a no-op behind a confirmation message.
      switch (tab) {
        case "files":
          setWorkspaceState("files");
          break;
        case "browser":
          setWorkspaceState("browser");
          break;
        case "preview":
          setWorkspaceState("design");
          break;
        case "checks":
          setHealthPanel({ mode: "checks", runTrigger: 0 });
          setWorkspaceState("activity");
          break;
        case "approvals":
          setHealthPanel({ mode: "approvals", runTrigger: 0 });
          setWorkspaceState("activity");
          break;
        case "plan":
        case "changes":
        default:
          // The deck IS the plan/changes surface now.
          setDeckCollapsed(false);
          setDeckExpanded(true);
          setDeckTab("chat");
          break;
      }
    },
    onRunHealthChecks: () => {
      // Real check execution via StudioHealthPanel's run-all, shown in the
      // Activity workspace — this is what "results will appear in the
      // Project Health panel" promises.
      setHealthPanel((prev) => ({ mode: "checks", runTrigger: (prev?.runTrigger ?? 0) + 1 }));
      setWorkspaceState("activity");
    },
    onOpenProjectNameDialog: () => {
      setProjectCreateError(null);
      setProjectNameDialogOpen(true);
    },
    onOpenImageStudio: (prompt) => {
      // P1-1: "Opening the image generator." must open the REAL generator
      // with the prompt prefilled — not a placeholder.
      setMediaRequest({ kind: "image", prompt });
      setWorkspaceState("images");
    },
    onOpenVideoStudio: (prompt) => {
      setMediaRequest({ kind: "video", prompt });
      setWorkspaceState("images");
    },
  });

  // F1 parity: keep the execution store's active task aligned so event
  // tagging follows the selected task.
  useEffect(() => {
    const conversationId = conversation.selectedConversationId;
    if (!conversationId) return;
    const matching = tasksRef.current.find((t) => t.conversationId === conversationId);
    if (matching && matching.id !== studioTasks.activeTaskId) {
      studioTasks.setActiveTaskId(matching.id);
      useExecutionStore.getState().setActiveTaskId(matching.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.selectedConversationId]);

  const persistSurface = useCallback(
    (taskId: string, nextWorkspace: WorkspaceId) => {
      // One PATCH per navigation, like the F1 worktab bar — restores the
      // workspace when the task is re-selected later.
      void studioTasks.activateTask(taskId, workspaceToSurface(nextWorkspace));
    },
    [studioTasks],
  );

  const selectWorkspace = useCallback(
    (next: WorkspaceId) => {
      setWorkspaceState(next);
      const taskId = activeTaskRef.current?.id;
      if (taskId) persistSurface(taskId, next);
    },
    [persistSurface],
  );

  const selectTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      const restored = surfaceToWorkspace(task.lastOpenedSurface);
      setWorkspaceState(restored);
      setSelection(null);
      await studioTasks.activateTask(taskId, workspaceToSurface(restored));
      useExecutionStore.getState().setActiveTaskId(taskId);
      if (task.conversationId) {
        useConversationStore.getState().selectConversation(task.conversationId);
        void conversation.loadMessages(task.conversationId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studioTasks],
  );

  const createNewTask = useCallback(async () => {
    // No title passed: the server defaults to "New task", and the first
    // send auto-names it. NEVER "Untitled N".
    const task = await studioTasks.createTask({});
    if (!task) return null;
    useExecutionStore.getState().setActiveTaskId(task.id);
    setWorkspaceState("design");
    setSelection(null);
    if (task.conversationId) {
      useConversationStore.getState().selectConversation(task.conversationId);
      void conversation.loadMessages(task.conversationId);
    }
    return task;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioTasks]);

  const renameTask = useCallback(
    (taskId: string, title: string) => studioTasks.renameTask(taskId, title),
    [studioTasks],
  );

  const closeTask = useCallback(
    (taskId: string) => studioTasks.closeTask(taskId),
    [studioTasks],
  );

  const clearSelection = useCallback(() => setSelection(null), []);

  const clearMediaRequest = useCallback(() => setMediaRequest(null), []);

  const startBlankProject = useCallback(
    async (name: string) => {
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
          body: JSON.stringify({ sourceType: "blank", name, templateId: "blank-static" }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setProjectCreateError(
            (err as { error?: string }).error || `Failed to create project (${res.status})`,
          );
          return;
        }
        const { project } = (await res.json()) as { project?: { id: string } };
        if (project?.id) {
          try {
            const key = userId ? `litt:active-project-id:${userId}` : "litt:active-project-id";
            window.localStorage.setItem(key, project.id);
          } catch {
            // ignore
          }
          const params = new URLSearchParams(searchParams.toString());
          params.set("project", project.id);
          window.dispatchEvent(new CustomEvent("studio:project-switching"));
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          await refreshCapabilities();
        }
        setProjectNameDialogOpen(false);
      } catch (error) {
        setProjectCreateError(error instanceof Error ? error.message : "Failed to create project");
      } finally {
        setCreatingProject(false);
      }
    },
    [creatingProject, getToken, userId, searchParams, router, pathname, refreshCapabilities],
  );

  const sendMessage = useCallback(
    async (value: string, attachments?: string[]) => {
      // First-message auto-naming: a placeholder-titled task takes its name
      // from what the user actually asked for.
      const task = activeTaskRef.current;
      if (task && isPlaceholderTitle(task.title)) {
        void studioTasks.renameTask(task.id, deriveTaskTitle(value));
      }
      const result = await conversation.send(value, attachments);
      if (result?.accepted) {
        if (projectId) {
          window.dispatchEvent(
            new CustomEvent("studio:files-changed", { detail: { projectId, source: "assistant" } }),
          );
        }
        if (result.pendingApproval) {
          // The run paused at an approval gate — surface the Live tab.
          setDeckTab("live");
          setDeckExpanded(true);
          setDeckCollapsed(false);
        } else {
          const previewReady = useExecutionStore
            .getState()
            .events.some((event) => event.type === "preview" && event.success);
          if (previewReady) setWorkspaceState("design");
        }
      }
      return result;
    },
    [conversation, studioTasks, projectId],
  );

  const applyInspectorEdit = useCallback(
    (instruction: string) => {
      // Inspector edits route through LiTT: prefill the composer with a
      // precise, selection-scoped instruction. The user reviews and sends —
      // no fake direct manipulation. On mobile this switches to the LiTT
      // tab, otherwise the prefill would land invisibly on the Panels tab.
      setComposerValue(instruction);
      setDeckCollapsed(false);
      setDeckTab("chat");
      setMobileTab("litt");
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLTextAreaElement>("[data-testid='studio-command-composer'] textarea")
          ?.focus();
      });
    },
    [],
  );

  const value = useMemo<StudioShellValue>(
    () => ({
      capabilities,
      capabilitiesLoading,
      tasks: studioTasks.tasks,
      closedTasks: studioTasks.closedTasks,
      tasksLoading: studioTasks.loading,
      activeTaskId: studioTasks.activeTaskId,
      activeTask: studioTasks.activeTask,
      selectTask,
      createNewTask,
      renameTask,
      closeTask,
      workspace,
      selectWorkspace,
      selection,
      setSelection,
      clearSelection,
      conversation,
      composerValue,
      setComposerValue,
      sendMessage,
      applyInspectorEdit,
      deckCollapsed,
      setDeckCollapsed,
      deckExpanded,
      setDeckExpanded,
      deckTab,
      setDeckTab,
      inspectorCollapsed,
      setInspectorCollapsed,
      inspectorWidth,
      setInspectorWidth,
      mobileTab,
      setMobileTab,
      mediaRequest,
      clearMediaRequest,
      healthPanel,
      projectNameDialogOpen,
      setProjectNameDialogOpen,
      creatingProject,
      projectCreateError,
      startBlankProject,
    }),
    [
      capabilities,
      capabilitiesLoading,
      studioTasks,
      selectTask,
      createNewTask,
      renameTask,
      closeTask,
      workspace,
      selectWorkspace,
      selection,
      clearSelection,
      conversation,
      composerValue,
      sendMessage,
      applyInspectorEdit,
      deckCollapsed,
      deckExpanded,
      deckTab,
      inspectorCollapsed,
      inspectorWidth,
      mobileTab,
      mediaRequest,
      clearMediaRequest,
      healthPanel,
      projectNameDialogOpen,
      creatingProject,
      projectCreateError,
      startBlankProject,
    ],
  );

  // The Image/Video tools (and future tool surfaces) read projectId and
  // session identity from StudioContext — provide the shell's values so
  // they don't throw outside CommandStudio.
  return (
    <StudioShellContext.Provider value={value}>
      <StudioContextProvider
        projectId={projectId ?? null}
        sessionId={conversation.selectedConversationId ?? `shell-${projectId ?? "none"}`}
        workspaceMode="preview"
        creator={null}
      >
        {children}
      </StudioContextProvider>
    </StudioShellContext.Provider>
  );
}
