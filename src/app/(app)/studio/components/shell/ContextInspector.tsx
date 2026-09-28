"use client";

/**
 * ContextInspector — the shell's right-side contextual panel.
 *
 * Content is driven by what's selected/active:
 *   builder/design node selected → real property editor (caller-supplied)
 *   preview element selected     → selection card + Ask-LiTT actions
 *   otherwise                    → the default inspector (plan/checks/…)
 *
 * Collapsible; width is fixed for now (resize is a later slice — the
 * interaction contract is what matters: right = "what is this thing").
 *
 * ContextInspectorContent is the same body rendered two ways: inside the
 * desktop <aside> here, and inside the phone bottom sheet
 * (MobileDragSheet) on the <768px tier. Presentation move only.
 */
import { type ReactNode } from "react";
import { ChevronRight, MousePointer2, Sparkles, X } from "lucide-react";

export interface InspectorSelection {
  label?: string;
  tagName?: string;
  sourceFile?: string;
  route?: string;
}

interface InspectorContentProps {
  /** Element selected in Preview/Design, if any. */
  selection: InspectorSelection | null;
  onAskAboutSelection: () => void;
  onClearSelection: () => void;
  /** Real property editor when a structured builder node is selected. */
  propertiesContent: ReactNode | null;
  /** A full editor that owns the selection body (e.g.
      ElementInspectorPanel for a preview element — it renders its own
      header, current values, and write controls). */
  editor?: ReactNode;
  /** Fallback inspector (plan/checks/telemetry). */
  defaultContent: ReactNode;
  onToggle: () => void;
}

/**
 * ContextInspectorContent — the inspector body shared by the desktop
 * aside and the phone sheet. Mechanical extraction: no logic changes.
 */
export function ContextInspectorContent({
  selection,
  onAskAboutSelection,
  onClearSelection,
  propertiesContent,
  editor,
  defaultContent,
  onToggle,
}: InspectorContentProps) {
  const hasSelection = Boolean(propertiesContent) || Boolean(selection);

  return (
    <>
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b px-3"
        style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
      >
        <span className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--text-secondary)" }}>
          {hasSelection ? "Inspector · Selection" : "Inspector"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggle}
          aria-label="Close inspector"
          title="Close inspector"
          className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronRight size={13} className="pointer-events-none" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {editor ?? propertiesContent ?? (selection ? (
          <div className="flex flex-col gap-3 p-3" data-testid="inspector-selection-card">
            <div className="flex items-start gap-2">
              <MousePointer2 size={14} className="mt-0.5 shrink-0" style={{ color: "var(--litt-primary)" }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold" style={{ color: "var(--text-main)" }}>
                  {selection.label || selection.tagName || "Selected element"}
                </p>
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {selection.tagName && selection.label ? selection.tagName : null}
                  {selection.sourceFile ? ` ${selection.sourceFile}` : ""}
                  {selection.route ? ` · ${selection.route}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={onClearSelection}
                aria-label="Clear selection"
                title="Clear selection"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={12} className="pointer-events-none" />
              </button>
            </div>

            <button
              type="button"
              onClick={onAskAboutSelection}
              data-testid="inspector-ask-litt"
              className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-bold transition-colors"
              style={{
                borderColor: "color-mix(in srgb, var(--color-accent) 35%, transparent)",
                color: "var(--text-main)",
                backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              }}
            >
              <Sparkles size={12} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
              Ask LiTT to change this
            </button>
          </div>
        ) : defaultContent)}
      </div>
    </>
  );
}

export default function ContextInspector({
  open,
  onToggle,
  selection,
  onAskAboutSelection,
  onClearSelection,
  propertiesContent,
  editor,
  defaultContent,
}: {
  open: boolean;
  onToggle: () => void;
  /** Element selected in Preview/Design, if any. */
  selection: InspectorSelection | null;
  onAskAboutSelection: () => void;
  onClearSelection: () => void;
  /** Real property editor when a structured builder node is selected. */
  propertiesContent: ReactNode | null;
  /** A full editor that owns the selection body (e.g.
      ElementInspectorPanel for a preview element — it renders its own
      header, current values, and write controls). */
  editor?: ReactNode;
  /** Fallback inspector (plan/checks/telemetry). */
  defaultContent: ReactNode;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Open inspector"
        title="Open inspector"
        data-testid="studio-inspector-open"
        className="glass-shell flex w-5 shrink-0 items-center justify-center border-l"
        style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)", backgroundColor: "rgba(13,9,22,0.6)" }}
      >
        <ChevronRight
          size={12}
          className="pointer-events-none -rotate-180"
          style={{ color: "var(--text-muted)" }}
        />
      </button>
    );
  }

  return (
    <aside
      aria-label="Inspector"
      data-testid="studio-context-inspector"
      className="glass-shell flex w-[300px] shrink-0 flex-col border-l xl:w-[340px]"
      style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)", backgroundColor: "rgba(13,9,22,0.85)" }}
    >
      <ContextInspectorContent
        selection={selection}
        onAskAboutSelection={onAskAboutSelection}
        onClearSelection={onClearSelection}
        propertiesContent={propertiesContent}
        editor={editor}
        defaultContent={defaultContent}
        onToggle={onToggle}
      />
    </aside>
  );
}
