"use client";

/**
 * StudioInspector — contextual selection inspector (F1 slice C).
 *
 * This is the inspector content for the StudioDock's Inspector tab. It
 * shows ONLY the real, active Studio selection:
 *
 * - selection present → provenance (label, kind, sourceFile/route,
 *   selector), actions (Ask LiTT with the structured payload,
 *   Reveal in Code when a source file is known), and a clear-selection
 *   affordance.
 * - nothing selected → an honest empty state. Never fake content.
 *
 * The Ask LiTT button dispatches `studio:ask-litt` with
 * `{ selection: StudioSelectionPayload }`. The shell's handler opens the
 * canonical LiTT chat; the selection is already the active StudioContext
 * selection, so the next send carries it to the LLM (see
 * useCanonicalConversation's send path).
 */

import { Crosshair, MessageSquareText, FileCode2, X } from "lucide-react";
import { STUDIO_EVENT_OPEN_FILE } from "@/lib/canvas/panel-actions";
import {
  toSelectionPayload,
  type StudioSelectionKind,
  type StudioSelectionValue,
} from "../context/StudioContext";

export interface SelectionInspectorPanelProps {
  /** Active selection from StudioContext (legacy shape or full payload). */
  selection: StudioSelectionValue | null;
  /** Project id — used for the "Reveal in Code" event. */
  projectId?: string | null;
  /** Clear the selection (wired to StudioContext.setSelection(null)). */
  onClear?: () => void;
  /** Optional className for embedding. */
  className?: string;
}

const KIND_LABELS: Record<StudioSelectionKind, string> = {
  "preview-element": "Preview",
  "canvas-node": "Canvas",
  "canvas-block": "Canvas block",
  "code-range": "Code",
  file: "File",
  asset: "Asset",
};

function ProvenanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-start justify-between gap-3 border-b py-1.5 last:border-0"
      style={{ borderColor: "var(--studio-border)" }}
    >
      <span
        className="shrink-0 text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-right font-mono text-[10px] font-bold"
        style={{ color: "var(--text-secondary)" }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function SelectionInspectorPanel({
  selection,
  projectId,
  onClear,
  className,
}: SelectionInspectorPanelProps) {
  // ── Honest empty state: no selection, no fake content ──
  if (!selection) {
    return (
      <div
        className={className}
        data-testid="selection-inspector-empty"
        role="status"
      >
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2.5"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "var(--studio-card)",
          }}
        >
          <Crosshair
            size={13}
            className="shrink-0"
            style={{ color: "var(--text-muted)" }}
            aria-hidden
          />
          <p
            className="text-[11px] leading-4"
            style={{ color: "var(--text-muted)" }}
          >
            Select an element in Preview or Canvas to inspect it.
          </p>
        </div>
      </div>
    );
  }

  const payload = toSelectionPayload(selection, {
    kind: "preview-element",
    projectId: projectId ?? "",
  });
  const kind: StudioSelectionKind = payload?.kind ?? selection.kind ?? "preview-element";
  const label =
    payload?.label ?? selection.label ?? selection.content ?? selection.elementId ?? "Selected element";
  const sourceFile = payload?.sourceFile ?? selection.sourceFile;
  const route = payload?.route ?? selection.route;
  const selector = payload?.selector ?? selection.selector;
  const tagName = payload?.tagName ?? selection.tagName;
  const content =
    typeof payload?.content === "string" && payload.content.trim().length > 0
      ? payload.content
      : typeof selection.content === "string" && selection.content.trim().length > 0
        ? selection.content
        : null;

  const handleAskLiTT = () => {
    window.dispatchEvent(
      new CustomEvent("studio:ask-litt", {
        detail: payload ? { selection: payload } : {},
      }),
    );
  };

  const handleRevealInCode = () => {
    if (!sourceFile) return;
    window.dispatchEvent(
      new CustomEvent(STUDIO_EVENT_OPEN_FILE, {
        detail: { projectId: projectId ?? undefined, path: sourceFile },
      }),
    );
  };

  return (
    <div
      className={className}
      data-testid="selection-inspector"
      style={{
        borderBottom: "1px solid var(--studio-border)",
        backgroundColor: "var(--studio-card)",
      }}
    >
      <div className="px-3 py-2.5">
        {/* Header: kind chip + label + clear */}
        <div className="mb-1.5 flex min-w-0 items-center gap-2">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest"
            style={{
              backgroundColor: "var(--litt-primary-soft, rgba(114,242,56,0.12))",
              color: "var(--litt-primary)",
            }}
          >
            {KIND_LABELS[kind] ?? kind}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12px] font-black"
            style={{ color: "var(--text-primary)" }}
            title={label}
          >
            {label}
          </span>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md transition hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Clear selection"
              title="Clear selection"
              data-testid="selection-inspector-clear"
            >
              <X size={12} className="pointer-events-none" />
            </button>
          )}
        </div>

        {/* Provenance — only real fields, no placeholders */}
        <div className="rounded-lg border px-2.5" style={{ borderColor: "var(--studio-border)" }}>
          <ProvenanceRow label="Kind" value={KIND_LABELS[kind] ?? kind} />
          {sourceFile && <ProvenanceRow label="Source" value={sourceFile} />}
          {route && <ProvenanceRow label="Route" value={route} />}
          {selector && <ProvenanceRow label="Selector" value={selector} />}
          {tagName && <ProvenanceRow label="Element" value={`<${tagName}>`} />}
          {content && (
            <ProvenanceRow
              label="Content"
              value={content.length > 80 ? `${content.slice(0, 80)}…` : content}
            />
          )}
        </div>

        {/* Actions */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleAskLiTT}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition hover:brightness-110"
            style={{
              backgroundColor: "var(--litt-primary)",
              color: "#0b0b0f",
            }}
            data-testid="selection-inspector-ask-litt"
          >
            <MessageSquareText size={11} className="pointer-events-none" />
            Ask LiTT
          </button>
          {sourceFile && (
            <button
              type="button"
              onClick={handleRevealInCode}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition hover:bg-white/5"
              style={{
                borderColor: "var(--studio-border)",
                color: "var(--text-secondary)",
              }}
              data-testid="selection-inspector-reveal"
            >
              <FileCode2 size={11} className="pointer-events-none" />
              Reveal in Code
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SelectionInspectorPanel;
