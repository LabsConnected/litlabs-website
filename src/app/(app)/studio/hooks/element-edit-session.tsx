"use client";

/**
 * One useElementEdits instance for the inspector and the canvas.
 * Moves and resizes call the same applyPatch the inspector's fields use,
 * so they share the file write, the undo stack, and the resolved element.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useElementEdits } from "./useElementEdits";

export interface ElementEditSelection {
  selector: string;
  tagName: string;
  label?: string;
  attrs?: Record<string, string>;
  text?: string;
  path?: string;
}

type ElementEditSession = ReturnType<typeof useElementEdits>;

const ElementEditSessionContext = createContext<ElementEditSession | null>(null);

export function ElementEditSessionProvider({
  projectId,
  selection,
  route = null,
  children,
}: {
  projectId: string | null;
  selection: ElementEditSelection | null;
  route?: string | null;
  children: ReactNode;
}) {
  const edits = useElementEdits(projectId);
  const selKey = selection ? `${selection.selector}|${selection.tagName}|${selection.path ?? ""}` : "";

  useEffect(() => {
    if (!selection || !projectId) return;
    void edits.resolve({
      selector: selection.selector,
      tagName: selection.tagName,
      label: selection.label,
      attrs: selection.attrs,
      text: selection.text,
      path: selection.path,
    }, route);
    // Re-resolve only when the element identity changes. Style updates from
    // a drag must not refetch and race the in-flight patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, route, projectId]);

  return (
    <ElementEditSessionContext.Provider value={edits}>
      {children}
    </ElementEditSessionContext.Provider>
  );
}

export function useElementEditSessionOptional(): ElementEditSession | null {
  return useContext(ElementEditSessionContext);
}
