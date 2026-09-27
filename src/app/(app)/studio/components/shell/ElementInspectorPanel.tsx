"use client";

/**
 * ElementInspectorPanel — the inspector editor for a selected preview
 * element. Every control writes a real inline-style/attribute/text patch
 * to the workspace file the element was resolved into (useElementEdits).
 *
 * Honesty contract:
 *   - "resolving" → spinner.
 *   - "unavailable"/error → reason text + Ask LiTT, NO controls.
 *   - A save only claims success after the file write returns ok.
 *   - Fields prefill from the element's computed styles at selection
 *     time (capture in the preview bridge) — blank means "unchanged".
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, RotateCw, Sparkles, X } from "lucide-react";
import type { PreviewSelection } from "../StudioPreviewPanel";
import type { StudioSelectionPayload } from "../../context/StudioContext";
import type { ElementPatch } from "../../lib/element-edits";
import { useElementEdits } from "../../hooks/useElementEdits";

/** Accepts the PreviewPanel shape OR the pinned canonical payload — the
    ask-litt pin stamps StudioSelectionPayload into the same slot. */
export type ElementSelectionLike = PreviewSelection | StudioSelectionPayload;

function normalizeSelection(selection: ElementSelectionLike): PreviewSelection {
  if ("kind" in selection) {
    return {
      label: selection.label,
      selector: selection.selector ?? selection.elementId ?? "",
      tagName: selection.tagName ?? "",
      attrs: selection.attrs,
      styles: selection.styles,
      text: selection.text ?? selection.content,
      path: selection.path,
      rect: selection.rect,
    };
  }
  return selection;
}

const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "button", "li",
  "label", "figcaption", "blockquote", "strong", "em", "small", "td", "th",
]);
const VOID_TAGS = new Set(["img", "input", "br", "hr", "meta", "link", "source", "wbr"]);

const FIELD = "w-full rounded-md border bg-black/20 px-2 py-1 text-[11px] outline-none";
const FIELD_STYLE = { borderColor: "rgba(255,255,255,0.1)", color: "var(--text-main)" } as const;
const LABEL = "text-[9px] font-bold uppercase tracking-[0.08em]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t px-3 py-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <div className="mb-2" style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em" }}>
        {title.toUpperCase()}
      </div>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

function TextField({
  label, value, placeholder, onCommit, testId,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  return (
    <label className="block">
      <span className={LABEL} style={{ color: "var(--text-muted)" }}>{label}</span>
      <input
        type="text"
        className={`${FIELD} mt-0.5`}
        style={FIELD_STYLE}
        value={draft}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (dirty) onCommit(draft); }}
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) onCommit(draft); }}
      />
    </label>
  );
}

function SelectField({
  label, value, options, onCommit, testId,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onCommit: (v: string) => void;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className={LABEL} style={{ color: "var(--text-muted)" }}>{label}</span>
      <select
        className={`${FIELD} mt-0.5`}
        style={FIELD_STYLE}
        value={value}
        data-testid={testId}
        onChange={(e) => onCommit(e.target.value)}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export default function ElementInspectorPanel({
  selection: rawSelection,
  projectId,
  route,
  onAskAboutSelection,
  onClearSelection,
}: {
  selection: ElementSelectionLike;
  projectId: string | null;
  route: string | null;
  onAskAboutSelection?: () => void;
  onClearSelection?: () => void;
}) {
  const selection = useMemo(() => normalizeSelection(rawSelection), [rawSelection]);
  const edits = useElementEdits(projectId);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const selKey = `${selection.selector}|${selection.tagName}`;
  useEffect(() => {
    setLastError(null);
    void edits.resolve({
      selector: selection.selector,
      tagName: selection.tagName,
      label: selection.label,
      attrs: selection.attrs,
      text: selection.text,
      path: selection.path,
    }, route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, route, projectId]);

  const apply = async (patch: ElementPatch) => {
    const ok = await edits.applyPatch(patch);
    if (ok) {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
    } else if (edits.statusReason) {
      setLastError(edits.statusReason);
    }
  };

  const setStyle = (prop: string) => (v: string) => {
    void apply({ styles: { [prop]: v.trim() || null } });
  };
  const setAttr = (name: string) => (v: string) => {
    void apply({ attrs: { [name]: v.trim() || null } });
  };

  const styles = selection.styles ?? {};
  const tag = selection.tagName.toLowerCase();
  const editable = edits.status === "ready" || edits.status === "applying";
  const showText = TEXT_TAGS.has(tag) || (!VOID_TAGS.has(tag) && !!selection.text);

  const statusLine = useMemo(() => {
    if (edits.status === "resolving") return "Resolving element in project files…";
    if (edits.status === "applying") return "Saving…";
    if (savedFlash) return "Saved";
    if (edits.status === "unavailable") return "Not directly editable";
    if (edits.status === "error") return "Save failed";
    return edits.filePath ?? "";
  }, [edits.status, edits.filePath, savedFlash]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="element-inspector-panel">
      {/* identity header */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold" style={{ color: "var(--text-main)" }} title={selection.label}>
              {selection.label}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }} title={selection.selector}>
              {selection.selector}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onAskAboutSelection && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold"
                style={{ borderColor: "rgba(190,145,255,0.3)", color: "var(--accent-color, #9b4dff)" }}
                onClick={onAskAboutSelection}
                data-testid="inspector-ask-litt"
              >
                <Sparkles size={11} /> Ask LiTT
              </button>
            )}
            {onClearSelection && (
              <button
                type="button"
                aria-label="Clear selection"
                className="grid h-6 w-6 place-items-center rounded-md"
                style={{ color: "var(--text-muted)" }}
                onClick={onClearSelection}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
          {(edits.status === "resolving" || edits.status === "applying") && <Loader2 size={10} className="animate-spin" />}
          <span data-testid="element-edit-status">{statusLine}</span>
          {selection.rect && selection.rect.width > 0 && (
            <span className="ml-auto shrink-0 font-mono">{selection.rect.width}×{selection.rect.height}</span>
          )}
        </div>
      </div>

      {lastError && (
        <div className="mx-3 mb-2 rounded-md border px-2 py-1.5 text-[10px]" style={{ borderColor: "rgba(239,68,68,0.35)", color: "#fca5a5" }}>
          {lastError}
        </div>
      )}

      {!editable && edits.status === "unavailable" && edits.statusReason && (
        <div className="mx-3 mb-2 rounded-md border px-2.5 py-2 text-[10px] leading-relaxed" style={{ borderColor: "rgba(255,255,255,0.09)", color: "var(--text-secondary)" }}>
          {edits.statusReason}
        </div>
      )}

      {editable && (
        <>
          {showText && (
            <div className="border-t px-3 py-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="mb-2" style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em" }}>CONTENT</div>
              <TextField
                label="Text"
                value={selection.text ?? ""}
                placeholder="Element text"
                testId="element-edit-text"
                onCommit={(v) => void apply({ text: v })}
              />
            </div>
          )}

          {tag === "img" && (
            <Section title="Image">
              <div className="col-span-2">
                <TextField label="Source" value={selection.attrs?.["src"] ?? ""} placeholder="https://… or /path.png" testId="element-edit-src" onCommit={setAttr("src")} />
              </div>
              <div className="col-span-2">
                <TextField label="Alt" value={selection.attrs?.["alt"] ?? ""} testId="element-edit-alt" onCommit={setAttr("alt")} />
              </div>
            </Section>
          )}

          {tag === "a" && (
            <Section title="Link">
              <div className="col-span-2">
                <TextField label="Href" value={selection.attrs?.["href"] ?? ""} placeholder="/route or https://…" testId="element-edit-href" onCommit={setAttr("href")} />
              </div>
            </Section>
          )}

          <Section title="Typography">
            <TextField label="Font size" value={styles["font-size"] ?? ""} placeholder="16px" onCommit={setStyle("font-size")} />
            <SelectField
              label="Weight"
              value=""
              options={["300", "400", "500", "600", "700", "800"].map((w) => ({ value: w, label: w }))}
              onCommit={setStyle("font-weight")}
            />
            <SelectField
              label="Style"
              value=""
              options={[{ value: "italic", label: "Italic" }, { value: "normal", label: "Normal" }]}
              onCommit={setStyle("font-style")}
            />
            <SelectField
              label="Align"
              value=""
              options={["left", "center", "right", "justify"].map((v) => ({ value: v, label: v }))}
              onCommit={setStyle("text-align")}
            />
            <TextField label="Line height" value={styles["line-height"] ?? ""} placeholder="1.5" onCommit={setStyle("line-height")} />
            <TextField label="Spacing" value={styles["letter-spacing"] ?? ""} placeholder="0.02em" onCommit={setStyle("letter-spacing")} />
          </Section>

          <Section title="Fill">
            <label className="block">
              <span className={LABEL} style={{ color: "var(--text-muted)" }}>Text color</span>
              <div className="mt-0.5 flex gap-1">
                <input type="color" className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" value={toHex(styles["color"])} data-testid="element-edit-color" onChange={(e) => void apply({ styles: { color: e.target.value } })} />
                <input type="text" className={FIELD} style={FIELD_STYLE} value={styles["color"] ?? ""} onChange={() => undefined} readOnly />
              </div>
            </label>
            <label className="block">
              <span className={LABEL} style={{ color: "var(--text-muted)" }}>Background</span>
              <div className="mt-0.5 flex gap-1">
                <input type="color" className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" value={toHex(styles["background-color"])} data-testid="element-edit-bg" onChange={(e) => void apply({ styles: { "background-color": e.target.value } })} />
                <input type="text" className={FIELD} style={FIELD_STYLE} value={styles["background-color"] ?? ""} onChange={() => undefined} readOnly />
              </div>
            </label>
          </Section>

          <Section title="Spacing">
            <TextField label="Padding" value={styles["padding"] ?? ""} placeholder="16px" onCommit={setStyle("padding")} />
            <TextField label="Margin" value={styles["margin"] ?? ""} placeholder="8px" onCommit={setStyle("margin")} />
          </Section>

          <Section title="Size">
            <TextField label="Width" value={styles["width"] ?? ""} placeholder="auto" onCommit={setStyle("width")} />
            <TextField label="Height" value={styles["height"] ?? ""} placeholder="auto" onCommit={setStyle("height")} />
          </Section>

          <Section title="Border">
            <TextField label="Radius" value={styles["border-radius"] ?? ""} placeholder="8px" onCommit={setStyle("border-radius")} />
            <TextField label="Border" value={styles["border"] ?? ""} placeholder="1px solid #333" onCommit={setStyle("border")} />
          </Section>

          <Section title="Layout">
            <SelectField
              label="Display"
              value=""
              options={["block", "inline-block", "inline", "flex", "grid", "none"].map((v) => ({ value: v, label: v }))}
              onCommit={setStyle("display")}
              testId="element-edit-display"
            />
            <TextField label="Gap" value={styles["gap"] ?? ""} placeholder="12px" onCommit={setStyle("gap")} />
            <SelectField
              label="Justify"
              value=""
              options={["flex-start", "center", "flex-end", "space-between", "space-around"].map((v) => ({ value: v, label: v }))}
              onCommit={setStyle("justify-content")}
            />
            <SelectField
              label="Align"
              value=""
              options={["flex-start", "center", "flex-end", "stretch", "baseline"].map((v) => ({ value: v, label: v }))}
              onCommit={setStyle("align-items")}
            />
          </Section>

          {/* actions */}
          <div className="border-t px-3 py-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="mb-2" style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em" }}>ACTIONS</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-[10px] font-bold disabled:opacity-40"
                style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--text-main)" }}
                disabled={!edits.canUndo}
                onClick={() => { void edits.undo(); }}
                data-testid="element-edit-undo"
                title="Undo last element edit"
              >
                <RotateCcw size={10} className="mr-1 inline" />Undo
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-[10px] font-bold disabled:opacity-40"
                style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--text-main)" }}
                disabled={!edits.canRedo}
                onClick={() => { void edits.redo(); }}
                data-testid="element-edit-redo"
              >
                <RotateCw size={10} className="mr-1 inline" />Redo
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1 text-[10px] font-bold"
                style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--text-main)" }}
                onClick={() => void apply({ duplicate: true })}
                data-testid="element-edit-duplicate"
              >
                Duplicate
              </button>
              {!confirmRemove ? (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-[10px] font-bold"
                  style={{ borderColor: "rgba(239,68,68,0.4)", color: "#fca5a5" }}
                  onClick={() => setConfirmRemove(true)}
                  data-testid="element-edit-remove"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md border px-2 py-1 text-[10px] font-bold"
                  style={{ borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.15)", color: "#fca5a5" }}
                  onClick={() => { setConfirmRemove(false); void apply({ remove: true }); }}
                  data-testid="element-edit-remove-confirm"
                >
                  Confirm remove
                </button>
              )}
            </div>

            {edits.history.length > 0 && (
              <div className="mt-2 space-y-1" data-testid="element-edit-history">
                {edits.history.slice(-5).reverse().map((h, i) => (
                  <div key={`${h.at}-${i}`} className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                    {h.filePath} — {h.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Best-effort hex for <input type=color> — rgb()→hex, passthrough else. */
function toHex(value: string | undefined): string {
  if (!value) return "#000000";
  const m = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/.exec(value.trim());
  if (!m) return value.startsWith("#") ? value.slice(0, 7) : "#000000";
  return `#${[m[1], m[2], m[3]].map((n) => parseInt(n, 10).toString(16).padStart(2, "0")).join("")}`;
}
