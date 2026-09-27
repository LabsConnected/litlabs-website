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
import type { WorkspaceStage, CreatorKind } from "@/app/(app)/studio/lib/studio-destinations";

// ─── Contract types ──────────────────────────────────────────────

/**
 * F1 canonical selection kind. The `kind` tells every consumer which
 * surface produced the selection and what the payload's fields mean.
 */
export type StudioSelectionKind = 'preview-element' | 'canvas-node' | 'code-range' | 'file' | 'asset' | 'canvas-block';

/**
 * F1 canonical selection payload — the contract sibling slices code
 * against. Carried across Preview / Canvas / Code / Chat and attached
 * to the real LLM request (see useCanonicalConversation's send path).
 */
export interface StudioSelectionPayload {
  kind: StudioSelectionKind; label: string;
  elementId?: string; selector?: string; tagName?: string;
  componentName?: string; sourceFile?: string; route?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  styles?: Record<string,string>; content?: string;
  projectId: string; worktabId?: string; conversationId?: string | null; timestamp: number;
}

export interface StudioSelection {
  elementId: string;
  componentName?: string;
  sourceFile?: string;
  route?: string;
  content?: string;
  styles?: Record<string, unknown>;
  // ── F1 payload fields (all optional — additive) ──
  /** Which surface produced the selection. */
  kind?: StudioSelectionKind;
  /** Human-readable label, e.g. "Hero heading". */
  label?: string;
  /** CSS selector for preview-element selections. */
  selector?: string;
  /** Lowercase tag name for preview-element selections. */
  tagName?: string;
  /** Bounding box in the producing surface's coordinates. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Owning project id (required on the full payload). */
  projectId?: string;
  /** Owning worktab id, when the selection came from a worktab. */
  worktabId?: string;
  /** Conversation the selection is attached to, if any. */
  conversationId?: string | null;
  /** Epoch ms when the selection was made. */
  timestamp?: number;
}

/**
 * Any selection value the Studio context can carry — the legacy shape
 * (still produced by the preview bridge) or the full F1 payload.
 */
export type StudioSelectionValue = StudioSelection | StudioSelectionPayload;

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

  /** Shared selection carried across Preview, Design, Code, and Chat. */
  selection: StudioSelectionValue | null;
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

  /** Preserve the same selected element across Studio surfaces. */
  setSelection: (selection: StudioSelectionValue | null) => void;
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

  /** Shared selection (controlled by CommandStudio). */
  selection?: StudioSelectionValue | null;

  /**
   * Callback to delegate workspace mode changes into the existing
   * routing state (CommandStudio's setStudioMode via
   * workspaceStageToMode).
   */
  onWorkspaceModeChange?: (mode: WorkspaceStage) => void;

  /** Selection changes from Preview/Design are shared by all surfaces. */
  onSelectionChange?: (selection: StudioSelectionValue | null) => void;

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
  selection = null,
  onWorkspaceModeChange,
  onSelectionChange,
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
      onSelectionChange?.(null);
    }
  }, [onSelectionChange, projectId]);

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

  const setSelection = useCallback(
    (next: StudioSelectionValue | null) => {
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  const value: StudioContextApi = useMemo(
    () => ({
      sessionId,
      projectId,
      workspaceMode,
      creator,
      activeFile,
      activeAssetId,
      selection,
      setWorkspaceMode,
      setCreator,
      setActiveFile,
      setActiveAssetId,
      setSelection,
    }),
    [
      sessionId,
      projectId,
      workspaceMode,
      creator,
      activeFile,
      activeAssetId,
      selection,
      setWorkspaceMode,
      setCreator,
      setSelection,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

// ─── Selection payload helpers (F1 slice C) ──────────────────────
// Pure functions — safe to import anywhere, including non-React modules.

/**
 * Type guard: true when the value is a full F1 StudioSelectionPayload
 * (all required fields present), not the legacy StudioSelection shape.
 */
export function isStudioSelectionPayload(
  value: unknown,
): value is StudioSelectionPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as unknown as Record<string, unknown>;
  return (
    typeof v.kind === "string" &&
    typeof v.label === "string" &&
    typeof v.projectId === "string" &&
    typeof v.timestamp === "number"
  );
}

/** Fallback fields for building a payload from a legacy selection. */
export interface SelectionPayloadFallback {
  kind: StudioSelectionKind;
  projectId: string;
  /** Used when the legacy selection has no label/content/elementId. */
  label?: string;
  elementId?: string;
  componentName?: string;
  content?: string;
  worktabId?: string;
  conversationId?: string | null;
}

/**
 * Normalize any context selection into a full StudioSelectionPayload.
 * A value that is already a payload passes through unchanged. A legacy
 * selection is upgraded with the caller's fallback kind/project. Returns
 * null when there is nothing to build from.
 */
export function toSelectionPayload(
  selection: StudioSelectionValue | null | undefined,
  fallback?: SelectionPayloadFallback,
): StudioSelectionPayload | null {
  if (isStudioSelectionPayload(selection)) return selection;
  const label =
    selection?.label ??
    selection?.content ??
    selection?.elementId ??
    fallback?.label ??
    null;
  if (!label || !fallback) return null;
  const styles = selection?.styles;
  const stringStyles: Record<string, string> | undefined = styles
    ? Object.fromEntries(
        Object.entries(styles).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]),
      )
    : undefined;
  return {
    kind: fallback.kind,
    label,
    elementId: selection?.elementId ?? fallback.elementId,
    selector: selection?.selector,
    tagName: selection?.tagName,
    componentName: selection?.componentName ?? fallback.componentName,
    sourceFile: selection?.sourceFile,
    route: selection?.route,
    bounds: selection?.bounds,
    styles: stringStyles,
    content: selection?.content ?? fallback.content,
    projectId: fallback.projectId,
    worktabId: selection?.worktabId ?? fallback.worktabId,
    conversationId: selection?.conversationId ?? fallback.conversationId ?? null,
    timestamp: selection?.timestamp ?? Date.now(),
  };
}

/**
 * Format the compact, clearly-marked context block that travels with the
 * outgoing chat message so the model sees the selected element's label
 * AND source. Example:
 *   [Selected: Hero heading — src/components/Hero.tsx @ / (preview-element)]
 * Only present parts are rendered; returns null when there is no selection.
 */
export function formatSelectionContextBlock(
  selection: StudioSelectionValue | null | undefined,
): string | null {
  if (!selection) return null;
  const label =
    selection.label ?? selection.content ?? selection.elementId ?? "selected element";
  const sourceParts: string[] = [];
  if (selection.sourceFile) sourceParts.push(selection.sourceFile);
  if (selection.route) sourceParts.push(`@ ${selection.route}`);
  if (selection.selector && !selection.sourceFile) sourceParts.push(selection.selector);
  const where = sourceParts.length > 0 ? ` — ${sourceParts.join(" ")}` : "";
  const kind = selection.kind ? ` (${selection.kind})` : "";
  return `[Selected: ${label}${where}${kind}]`;
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

/**
 * useStudioContextOptional — like useStudioContext but returns null
 * outside a provider instead of throwing. For components (e.g. the
 * StudioDock, canvas surfaces) that can render without a provider —
 * in tests or in surfaces mounted outside the Studio tree.
 */
export function useStudioContextOptional(): StudioContextApi | null {
  return useContext(StudioContext);
}
