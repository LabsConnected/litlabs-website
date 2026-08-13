/**
 * StudioContext — canonical cross-Studio session context.
 *
 * This is the single canonical context that travels across
 * Plan / Canvas / Code / Preview and across all creator surfaces.
 *
 * CRITICAL DESIGN RULES (Phase D.1 — controlled state ownership):
 *
 * 1. The four authoritative values — projectId, sessionId,
 *    workspaceMode, creator — are CONTROLLED PROPS. The parent
 *    (CommandStudio) owns them and passes them in. The provider does
 *    NOT mirror them in internal state. This eliminates the
 *    StudioContextSync / _set* bridge that previously duplicated
 *    routing state and could drift.
 *
 * 2. workspaceMode and creator are INDEPENDENT. The parent must
 *    preserve the last Plan/Canvas/Code/Preview stage when a creator
 *    is activated, so the context can represent e.g.
 *    { workspaceMode: "code", creator: "image" }.
 *
 * 3. activeFile and activeAssetId are the only state the provider
 *    owns. They are cleared when projectId changes (detected via a
 *    ref comparison on the controlled prop).
 *
 * 4. setWorkspaceMode() and setCreator() delegate into the EXISTING
 *    routing state via callbacks. They do not create route drift.
 *    setCreator(null) exits the creator surface and returns to the
 *    last workspace stage — the parent handles this routing.
 *
 * 5. sessionId is a controlled prop. The parent derives it from the
 *    canonical conversationId when available, or a deterministic
 *    fallback. The provider does not generate random IDs.
 */

"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import type { WorkspaceStage, CreatorKind } from "@/app/studio/lib/studio-destinations";

// ─── Contract types ──────────────────────────────────────────────

export interface StudioContextValue {
  /** Stable session identity (controlled — from conversationId or deterministic fallback). */
  sessionId: string;

  /** Active project, or null if no project is selected (controlled). */
  projectId: string | null;

  /** Current workspace stage — INDEPENDENT from creator (controlled). */
  workspaceMode: WorkspaceStage;

  /** Active creator, or null if not in a creator surface (controlled). */
  creator: CreatorKind | null;

  /** Active file path in CodeWorkspace, or null (provider-owned). */
  activeFile: string | null;

  /** Active asset ID (canonical, source-qualified), or null (provider-owned). */
  activeAssetId: string | null;
}

export interface StudioContextActions {
  /** Switch workspace stage — delegates to existing routing. */
  setWorkspaceMode: (mode: WorkspaceStage) => void;

  /**
   * Switch creator — delegates to existing routing.
   * Pass null to exit the creator surface and return to the last
   * workspace stage (Plan/Canvas/Code/Preview).
   */
  setCreator: (creator: CreatorKind | null) => void;

  /** Set the active file path (provider-owned state). */
  setActiveFile: (path: string | null) => void;

  /** Set the active asset ID (provider-owned state). */
  setActiveAssetId: (id: string | null) => void;
}

export type StudioContextApi = StudioContextValue & StudioContextActions;

// ─── Context ─────────────────────────────────────────────────────

const StudioContext = createContext<StudioContextApi | null>(null);

// ─── Provider ────────────────────────────────────────────────────

export interface StudioContextProviderProps {
  children: ReactNode;

  /** Authoritative project ID (controlled). */
  projectId: string | null;

  /** Authoritative session ID (controlled — conversationId or deterministic fallback). */
  sessionId: string;

  /** Authoritative workspace stage (controlled — independent from creator). */
  workspaceMode: WorkspaceStage;

  /** Authoritative creator, or null (controlled). */
  creator: CreatorKind | null;

  /**
   * Callback to delegate workspace mode changes into the existing
   * routing state (CommandStudio's setStudioMode via
   * workspaceStageToMode).
   */
  onWorkspaceModeChange?: (mode: WorkspaceStage) => void;

  /**
   * Callback to delegate creator changes into the existing routing
   * state (CommandStudio's setCreateMode / setDestination).
   * setCreator(null) exits the creator surface.
   */
  onCreatorChange?: (creator: CreatorKind | null) => void;
}

/**
 * StudioContextProvider — the canonical cross-Studio context.
 *
 * Controlled props for projectId/sessionId/workspaceMode/creator.
 * Provider owns only activeFile/activeAssetId (cleared on project change).
 */
export function StudioContextProvider({
  children,
  projectId,
  sessionId,
  workspaceMode,
  creator,
  onWorkspaceModeChange,
  onCreatorChange,
}: StudioContextProviderProps) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);

  // Clear activeFile/activeAssetId when projectId changes.
  // Uses a ref to detect the change without mirroring projectId in state.
  const prevProjectIdRef = useRef<string | null>(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      setActiveFile(null);
      setActiveAssetId(null);
    }
  }, [projectId]);

  // Public: setWorkspaceMode delegates to existing routing.
  const setWorkspaceMode = useCallback(
    (mode: WorkspaceStage) => {
      onWorkspaceModeChange?.(mode);
    },
    [onWorkspaceModeChange],
  );

  // Public: setCreator delegates to existing routing.
  // null exits the creator surface — the parent handles returning
  // to the last workspace stage.
  const setCreator = useCallback(
    (c: CreatorKind | null) => {
      onCreatorChange?.(c);
    },
    [onCreatorChange],
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
