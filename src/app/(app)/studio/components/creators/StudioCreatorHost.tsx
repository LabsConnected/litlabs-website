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
 * The creator kind is derived SOLELY from StudioContext — there is no
 * competing `creator` prop. If StudioContext.creator is null, the host
 * is not mounted (the caller must guard against this).
 *
 * The existing creators (ImageTool, VideoTool, MusicTool, AudioTool,
 * DesignCanvas, SpaceTool) are rendered as children. They can opt-in
 * to asset registration via the useAssetRegistration hook.
 */

import { type ReactNode, createContext, useContext } from "react";
import { useStudioContext } from "@/app/(app)/studio/context/StudioContext";
import type { CreatorKind } from "@/app/(app)/studio/lib/studio-destinations";

// ─── Creator host context ────────────────────────────────────────

export interface StudioCreatorHostContextValue {
  /** The canonical creator kind for this host (from StudioContext). */
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
  /** The existing creator implementation to render. */
  children: ReactNode;
}

/**
 * StudioCreatorHost — wraps a creator implementation with canonical
 * Studio context. The creator kind is read from StudioContext; there
 * is no competing `creator` prop.
 *
 * If StudioContext.creator is null, this throws — callers must guard
 * against mounting the host when no creator is active.
 */
export function StudioCreatorHost({ children }: StudioCreatorHostProps) {
  const { projectId, sessionId, creator } = useStudioContext();

  if (!creator) {
    throw new Error(
      "StudioCreatorHost requires an active creator in StudioContext. " +
        "Do not mount the host when creator is null.",
    );
  }

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
