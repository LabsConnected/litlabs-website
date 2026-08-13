"use client";

/**
 * StudioCreatorHost — shared creator host wrapper.
 *
 * This is the narrow shared abstraction that wraps each existing creator
 * implementation. It:
 *
 * - Reads canonical StudioContext (projectId, sessionId, workspaceMode, creator)
 * - Renders the existing creator implementation as a child
 * - Provides asset-registration capability via context
 * - Does NOT own provider logic
 * - Does NOT duplicate routing
 * - Does NOT create another global state store
 *
 * The existing creators (ImageTool, VideoTool, MusicTool, AudioTool,
 * DesignCanvas, SpaceTool) are rendered as children. They can opt-in
 * to asset registration via the useAssetRegistration hook.
 */

import { type ReactNode, createContext, useContext } from "react";
import { useStudioContext } from "@/app/studio/context/StudioContext";
import type { CreatorKind } from "@/app/studio/lib/studio-destinations";

// ─── Creator host context ────────────────────────────────────────

export interface StudioCreatorHostContextValue {
  /** The canonical creator kind for this host. */
  creator: CreatorKind;
  /** Project ID from StudioContext (null if no project). */
  projectId: string | null;
  /** Session ID from StudioContext. */
  sessionId: string;
  /** Whether the creator is active (mounted and visible). */
  active: boolean;
}

const CreatorHostContext = createContext<StudioCreatorHostContextValue | null>(null);

/**
 * useCreatorHost — access the creator host context.
 * Throws if used outside a StudioCreatorHost.
 */
export function useCreatorHost(): StudioCreatorHostContextValue {
  const ctx = useContext(CreatorHostContext);
  if (!ctx) {
    throw new Error("useCreatorHost must be used within a StudioCreatorHost");
  }
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────

export interface StudioCreatorHostProps {
  /** The canonical creator kind. */
  creator: CreatorKind;
  /** The existing creator implementation to render. */
  children: ReactNode;
}

/**
 * StudioCreatorHost — wraps a creator implementation with canonical
 * Studio context. The creator can access context via useStudioContext()
 * or useCreatorHost().
 */
export function StudioCreatorHost({ creator, children }: StudioCreatorHostProps) {
  const { projectId, sessionId } = useStudioContext();

  const value: StudioCreatorHostContextValue = {
    creator,
    projectId,
    sessionId,
    active: true,
  };

  return (
    <CreatorHostContext.Provider value={value}>
      {children}
    </CreatorHostContext.Provider>
  );
}
