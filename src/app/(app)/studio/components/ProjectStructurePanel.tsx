"use client";

/**
 * ProjectStructurePanel — the Canvas & Design stage's page-structure
 * view (Build mode's structure, and Design mode's selection source
 * when the preview is not running).
 *
 * It reads the project's entry HTML file through the SAME files API
 * the element-edits write path uses, parses it with the bridge-
 * identical identity rules (lib/element-tree), and renders the
 * element tree. Clicking a node emits the exact PreviewSelection a
 * click inside the preview frame would produce, so the inspector
 * and the write path treat both sources identically.
 *
 * Honest states only: loading / no HTML entry page in the project /
 * unreadable file — never a fake tree.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { candidateHtmlFiles } from "../lib/element-edits";
import { buildStructureTree, type ElementTreeNode } from "../lib/element-tree";
import type { PreviewSelection } from "./StudioPreviewPanel";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; filePath: string; roots: ElementTreeNode[] }
  | { kind: "empty"; reason: string }
  | { kind: "error"; reason: string };

function toSelection(node: ElementTreeNode): PreviewSelection {
  return {
    label: node.label,
    selector: node.selector,
    tagName: node.tagName,
    attrs: node.attrs,
    styles: node.styles,
    text: node.text,
    path: node.path,
  };
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
}: {
  node: ElementTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  selectedPath: string | null;
  onSelect: (selection: PreviewSelection) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.key);
  const isSelected = selectedPath === node.key;
  const firstClass = (node.attrs?.["class"] ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return (
    <div>
      <div
        className="group flex items-center gap-1 pr-2 py-0.5"
        style={{
          paddingLeft: depth * 12 + 4,
          backgroundColor: isSelected ? "rgba(124,58,237,0.14)" : "transparent",
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.key)}
            aria-label={isOpen ? `Collapse ${node.tagName}` : `Expand ${node.tagName}`}
            className="grid h-4 w-4 shrink-0 place-items-center rounded text-zinc-400 hover:bg-black/5"
          >
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(toSelection(node))}
          data-testid="structure-node"
          data-path={node.key}
          aria-pressed={isSelected}
          title={node.selector}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span
            className="shrink-0 rounded px-1 py-px font-mono text-[9px] font-bold"
            style={{
              backgroundColor: "rgba(124,58,237,0.12)",
              color: isSelected ? "#7c3aed" : "var(--text-secondary)",
            }}
          >
            {node.tagName}
            {firstClass ? <span style={{ color: "var(--text-muted)" }}> .{firstClass}</span> : null}
          </span>
          <span
            className="truncate text-[11px]"
            style={{ color: isSelected ? "var(--text-main)" : "var(--text-secondary)" }}
          >
            {node.ownText ?? node.label}
          </span>
        </button>
      </div>
      {hasChildren && isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.key}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function ProjectStructurePanel({
  projectId,
  selectedPath,
  onSelect,
}: {
  projectId: string;
  selectedPath: string | null;
  onSelect: (selection: PreviewSelection) => void;
}) {
  const { getToken } = useClerkAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const projectRef = useRef(projectId);
  // getToken is read through a ref so `load` stays stable per project —
  // an unstable callback identity must never retrigger the load effect.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    projectRef.current = projectId;
    getTokenRef.current = getToken;
  });

  const load = useCallback(async () => {
    const forProject = projectId;
    setState({ kind: "loading" });
    try {
      const listRes = await fetch(
        `/api/studio-projects/${encodeURIComponent(forProject)}/files`,
      );
      if (projectRef.current !== forProject) return;
      if (!listRes.ok) {
        setState({ kind: "error", reason: "Workspace file list unavailable." });
        return;
      }
      const listData = (await listRes.json().catch(() => null)) as
        | { entries?: { name?: string; type?: string }[] }
        | null;
      const all = (listData?.entries ?? [])
        .filter((e) => e.type === "file" && typeof e.name === "string")
        .map((e) => e.name as string);
      const candidates = candidateHtmlFiles(null, all);
      if (candidates.length === 0) {
        setState({
          kind: "empty",
          reason:
            "This project has no HTML page to map. The structure view reads the project's entry HTML file — framework projects (React/Next.js) don't keep one, so pick elements in the live preview instead.",
        });
        return;
      }
      const token = await getTokenRef.current();
      for (const candidate of candidates) {
        const res = await fetch(
          `/api/studio-projects/${encodeURIComponent(forProject)}/files`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ action: "read", path: candidate }),
          },
        );
        if (projectRef.current !== forProject) return;
        if (!res.ok) continue;
        const data = (await res.json().catch(() => null)) as { content?: unknown } | null;
        if (typeof data?.content !== "string") continue;
        const roots = buildStructureTree(data.content);
        if (roots && roots.length > 0) {
          setState({ kind: "ready", filePath: candidate, roots });
          // Start with the first two levels open — the page's sections
          // are visible without expanding anything by hand.
          const initial = new Set<string>();
          const open = (nodes: ElementTreeNode[], depth: number) => {
            if (depth >= 2) return;
            for (const n of nodes) {
              initial.add(n.key);
              open(n.children, depth + 1);
            }
          };
          open(roots, 0);
          setExpanded(initial);
          return;
        }
      }
      setState({
        kind: "empty",
        reason: "The project's HTML page has no elements to show yet.",
      });
    } catch {
      if (projectRef.current !== forProject) return;
      setState({ kind: "error", reason: "Couldn't reach the workspace to read the page." });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Element edits (and agent writes) announce themselves on this
  // event — reload so the tree never shows a stale page.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      void load();
    };
    window.addEventListener("studio:files-changed", handler);
    return () => window.removeEventListener("studio:files-changed", handler);
  }, [load, projectId]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div
      className="flex w-60 shrink-0 flex-col overflow-hidden border-r"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="project-structure-panel"
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <span
          className="text-[10px] font-black uppercase tracking-[0.14em]"
          style={{ color: "var(--text-secondary)" }}
        >
          Page structure
        </span>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Reload page structure"
          title="Reload page structure"
          data-testid="structure-reload"
          className="grid h-6 w-6 place-items-center rounded text-zinc-400 transition hover:bg-black/5"
        >
          <RefreshCw size={11} aria-hidden="true" />
        </button>
      </div>
      {state.kind === "ready" && (
        <div
          className="shrink-0 truncate px-3 py-1 font-mono text-[9px]"
          style={{ color: "var(--text-muted)" }}
          title={state.filePath}
        >
          {state.filePath}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {state.kind === "loading" && (
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-zinc-500">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            Reading the page…
          </div>
        )}
        {(state.kind === "empty" || state.kind === "error") && (
          <p className="px-3 py-2 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }} role="status">
            {state.reason}
          </p>
        )}
        {state.kind === "ready" &&
          state.roots.map((node) => (
            <TreeRow
              key={node.key}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    </div>
  );
}
