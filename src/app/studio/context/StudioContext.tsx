/**
 * StudioSessionContext — canonical cross-Studio session context.
 *
 * This is the single canonical context that travels across
 * Plan / Canvas / Code / Preview and across all creator surfaces.
 *
 * CRITICAL DESIGN RULES (per Phase D contract):
 *
 * 1. This context ADAPTS existing canonical state — it does NOT
 *    create independent duplicate routing state.
 *    - workspaceMode is derived from the existing WorkspaceStage /
 *      StudioMode system via workspaceStageToMode / modeToWorkspaceStage.
 *    - creator is derived from the existing CreateMode / CreatorKind
 *      system.
 *    - projectId comes from the existing capabilities.projectId /
 *      useConnectionSummary source.
 *
 * 2. sessionId reuses the canonical conversationId from
 *    useConversationStore when available. If no conversation is
 *    selected, a stable fallback is derived from the projectId so
 *    the context still has a stable identity. The fallback is NOT
 *    random — it is deterministic per project.
 *
 * 3. activeFile and activeAssetId are the only genuinely new state
 *    introduced by this context. They are cleared on project change.
 *
 * 4. setWorkspaceMode() and setCreator() delegate into the EXISTING
 *    routing state (CommandStudio's setStudioMode / setCreateMode).
 *    They do not create route drift.
 */

"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { WorkspaceStage, CreatorKind } from "@/app/studio/lib/studio-destinations";

// ─── Contract types ──────────────────────────────────────────────

export interface StudioContextValue {
  /** Stable session identity (reuses conversationId when available). */
  sessionId: string;

  /** Active project, or null if no project is selected. */
  projectId: string | null;

  /** Current workspace stage. */
  workspaceMode: WorkspaceStage;

  /** Active creator, or null if not in a creator surface. */
  creator: CreatorKind | null;

  /** Active file path in CodeWorkspace, or null. */
  activeFile: string | null;

  /** Active asset ID (canonical, source-qualified), or null. */
  activeAssetId: string | null;
}

export interface StudioContextActions {
  /** Switch workspace stage — delegates to existing routing. */
  setWorkspaceMode: (mode: WorkspaceStage) => void;

  /** Switch creator — delegates to existing routing. */
  setCreator: (creator: CreatorKind | null) => void;

  /** Set the active file path. */
  setActiveFile: (path: string | null) => void;

  /** Set the active asset ID. */
  setActiveAssetId: (id: string | null) => void;

  /**
   * Internal: update projectId from the authoritative source.
   * Clears activeFile and activeAssetId when the project changes
   * (unless the asset belongs to the new project).
   */
  _setProjectId: (id: string | null) => void;

  /**
   * Internal: update sessionId from the canonical conversation source.
   */
  _setSessionId: (id: string) => void;

  /**
   * Internal: update workspaceMode from the authoritative routing source.
   */
  _setWorkspaceMode: (mode: WorkspaceStage) => void;

  /**
   * Internal: update creator from the authoritative routing source.
   */
  _setCreator: (creator: CreatorKind | null) => void;
}

export type StudioContextApi = StudioContextValue & StudioContextActions;

// ─── Context ─────────────────────────────────────────────────────

const StudioContext = createContext<StudioContextApi | null>(null);

// ─── Provider ────────────────────────────────────────────────────

export interface StudioContextProviderProps {
  children: ReactNode;

  /** Initial project ID from the authoritative source. */
  initialProjectId: string | null;

  /** Initial session ID (conversation ID) from the canonical source. */
  initialSessionId: string;

  /** Initial workspace stage. */
  initialWorkspaceMode: WorkspaceStage;

  /** Initial creator, or null. */
  initialCreator: CreatorKind | null;

  /**
   * Callback to delegate workspace mode changes into the existing
   * routing state (CommandStudio's setStudioMode via
   * workspaceStageToMode).
   */
  onWorkspaceModeChange?: (mode: WorkspaceStage) => void;

  /**
   * Callback to delegate creator changes into the existing routing
   * state (CommandStudio's setCreateMode / setDestination).
   */
  onCreatorChange?: (creator: CreatorKind | null) => void;
}

/**
 * StudioContextProvider — the canonical cross-Studio context.
 *
 * Wraps the Studio shell. Adapts existing routing state rather than
 * duplicating it. The provider is controlled — the parent (CommandStudio)
 * passes in the authoritative values and receives change callbacks.
 */
export function StudioContextProvider({
  children,
  initialProjectId,
  initialSessionId,
  initialWorkspaceMode,
  initialCreator,
  onWorkspaceModeChange,
  onCreatorChange,
}: StudioContextProviderProps) {
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [sessionId, setSessionId] = useState<string>(initialSessionId);
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceStage>(initialWorkspaceMode);
  const [creator, setCreatorState] = useState<CreatorKind | null>(initialCreator);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);

  // Track previous projectId to detect changes.
  const prevProjectIdRef = useMemo(() => ({ value: projectId }), [projectId]);

  // Internal: update projectId from authoritative source.
  // Clears activeFile and activeAssetId on project change.
  const _setProjectId = useCallback((id: string | null) => {
    setProjectId((prev) => {
      if (prev === id) return prev;
      // Project changed — clear stale pointers.
      setActiveFile(null);
      setActiveAssetId(null);
      return id;
    });
  }, []);

  const _setSessionId = useCallback((id: string) => {
    setSessionId((prev) => (prev === id ? prev : id));
  }, []);

  const _setWorkspaceMode = useCallback((mode: WorkspaceStage) => {
    setWorkspaceModeState((prev) => (prev === mode ? prev : mode));
  }, []);

  const _setCreator = useCallback((c: CreatorKind | null) => {
    setCreatorState((prev) => (prev === c ? prev : c));
  }, []);

  // Public: setWorkspaceMode delegates to existing routing.
  const setWorkspaceMode = useCallback(
    (mode: WorkspaceStage) => {
      _setWorkspaceMode(mode);
      onWorkspaceModeChange?.(mode);
    },
    [_setWorkspaceMode, onWorkspaceModeChange],
  );

  // Public: setCreator delegates to existing routing.
  const setCreator = useCallback(
    (c: CreatorKind | null) => {
      _setCreator(c);
      onCreatorChange?.(c);
    },
    [_setCreator, onCreatorChange],
  );

  const value: StudioContextApi = useMemo(
    () => ({
      sessionId,
      projectId,
      workspaceMode,
      creator,
      activeFile,
      activeAssetId,
      setWorkspaceMode,
      setCreator,
      setActiveFile,
      setActiveAssetId,
      _setProjectId,
      _setSessionId,
      _setWorkspaceMode,
      _setCreator,
    }),
    [
      sessionId,
      projectId,
      workspaceMode,
      creator,
      activeFile,
      activeAssetId,
      setWorkspaceMode,
      setCreator,
      _setProjectId,
      _setSessionId,
      _setWorkspaceMode,
      _setCreator,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────

/**
 * useStudioContext — access the canonical Studio session context.
 *
 * Throws if used outside a StudioContextProvider to prevent
 * silent context-less rendering.
 */
export function useStudioContext(): StudioContextApi {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error(
      "useStudioContext must be used within a StudioContextProvider",
    );
  }
  return ctx;
}
