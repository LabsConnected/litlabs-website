"use client";

/**
 * ElementEditsContext — shares ONE useElementEdits instance across the
 * Studio tree so the element inspector, the Design canvas gestures, and
 * undo/redo all read/write through the same file cache and history stack.
 *
 * Two independent instances would each keep their own cache: a geometry
 * commit from the canvas could write a file the inspector's stale cache
 * then clobbers on the next text edit. One instance = one revision view.
 */

import { createContext, useContext } from "react";
import { useElementEdits } from "../hooks/useElementEdits";

export type ElementEdits = ReturnType<typeof useElementEdits>;

export const ElementEditsContext = createContext<ElementEdits | null>(null);

/**
 * Returns the shared instance when a provider exists, otherwise a local
 * one (standalone usage/tests). The fallback instance is inert unless
 * its own resolve/applyPatch is called — it never double-writes because
 * only the returned instance is used by the caller.
 */
export function useSharedElementEdits(projectId: string | null): ElementEdits {
  const shared = useContext(ElementEditsContext);
  const local = useElementEdits(projectId);
  return shared ?? local;
}
