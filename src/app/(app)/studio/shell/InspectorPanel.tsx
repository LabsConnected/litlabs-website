"use client";

/**
 * Studio shell inspector — collapsible, resizable, selection-driven.
 *
 * Phase 1 truthfulness rule: the preview inspector bridge only supports
 * enable/disable/clear + select events — there is NO style-apply command.
 * So the inspector shows what IS true (selection info) and routes every edit
 * through LiTT via "Ask LiTT to change this", which prefills the deck's
 * composer with a precise, selection-scoped instruction. No fake text/color/
 * spacing editors.
 */

import { useCallback, useEffect, useRef } from "react";
import { ChevronRight, MessageSquareText, X } from "lucide-react";
import { useStudioShell } from "./StudioShellContext";

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

export function InspectorPanel({ fillWidth = false }: { fillWidth?: boolean }) {
  const {
    selection,
    clearSelection,
    applyInspectorEdit,
    inspectorCollapsed,
    setInspectorCollapsed,
    inspectorWidth,
    setInspectorWidth,
  } = useStudioShell();

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: inspectorWidth };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [inspectorWidth],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = drag.startWidth + (drag.startX - e.clientX);
      setInspectorWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next))));
    },
    [setInspectorWidth],
  );
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dragRef.current = null;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (inspectorCollapsed) {
    if (fillWidth) {
      return (
        <button
          type="button"
          onClick={() => setInspectorCollapsed(false)}
          className="flex w-full shrink-0 items-center justify-center gap-2 border-t py-2.5 text-[11px] font-bold uppercase tracking-wider"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
          aria-label="Open inspector"
          data-testid="studio-inspector-collapsed"
        >
          Inspector
          <ChevronRight size={14} className="-rotate-90" />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setInspectorCollapsed(false)}
        className="flex w-9 shrink-0 flex-col items-center gap-2 border-l py-3"
        style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
        aria-label="Open inspector"
        data-testid="studio-inspector-collapsed"
      >
        <ChevronRight size={14} className="rotate-180" style={{ color: "var(--text-muted)" }} />
        <span
          className="text-[9px] font-bold uppercase tracking-wider"
          style={{ color: "var(--text-muted)", writingMode: "vertical-rl" }}
        >
          Inspector
        </span>
      </button>
    );
  }

  const askLitt = () => {
    if (!selection) return;
    const target =
      selection.kind === "element"
        ? `the selected ${selection.tagName || "element"} "${selection.label}" (${selection.ref})`
        : `the selected ${selection.kind} "${selection.label}"`;
    applyInspectorEdit(`Change ${target}: `);
  };

  return (
    <aside
      className={`relative flex shrink-0 flex-col ${fillWidth ? "border-t" : "border-l"}`}
      style={{
        width: fillWidth ? "100%" : inspectorWidth,
        borderColor: "var(--studio-border)",
        backgroundColor: "var(--studio-surface)",
      }}
      data-testid="studio-inspector"
      aria-label="Inspector"
    >
      {!fillWidth && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
        />
      )}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
          Inspector
        </span>
        {selection && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{ borderColor: "rgba(163,230,53,0.35)", color: "var(--litt-primary)" }}
          >
            {selection.workspace}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setInspectorCollapsed(true)}
          className="rounded p-1 transition hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          aria-label="Collapse inspector"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!selection ? (
          <div className="py-8 text-center">
            <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Nothing selected
            </p>
            <p className="mx-auto mt-1.5 max-w-[220px] text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Click anything in the preview to inspect it here, then ask LiTT to change it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Selected {selection.kind}
              </div>
              <div className="mt-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {selection.label}
              </div>
              {selection.tagName && (
                <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  &lt;{selection.tagName}&gt;
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {selection.kind === "element" ? "Selector" : "Reference"}
              </div>
              <code
                className="mt-1 block break-all rounded-lg border px-2 py-1.5 text-[11px]"
                style={{
                  borderColor: "var(--studio-border)",
                  backgroundColor: "var(--studio-elevated)",
                  color: "var(--text-secondary)",
                }}
              >
                {selection.ref}
              </code>
            </div>
            <button
              type="button"
              onClick={askLitt}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition hover:opacity-85"
              style={{ backgroundColor: "var(--litt-primary)", color: "#0b0f04" }}
              data-testid="studio-inspector-ask-litt"
            >
              <MessageSquareText size={14} />
              Ask LiTT to change this
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition hover:opacity-80"
              style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
            >
              <X size={13} />
              Clear selection
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
