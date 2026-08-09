"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCanvasBuilderStore } from "./store";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--glass-text-3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function CollapsibleSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--glass-border)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 mb-2 text-[10px] font-black uppercase tracking-[0.1em]"
        style={{ color: "var(--glass-text-2)" }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title}
      </button>
      {open && <div className="grid grid-cols-2 gap-2">{children}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  backgroundColor: "rgba(255,255,255,0.04)",
  border: "1px solid var(--glass-border)",
  color: "var(--glass-text-1)",
  fontSize: 12,
  outline: "none",
};

export function PropertiesPanel() {
  const selectedNodeId = useCanvasBuilderStore((s) => s.selectedNodeId);
  const node = useCanvasBuilderStore((s) => (s.selectedNodeId ? s.document.nodes[s.selectedNodeId] : null));
  const updateNodeProps = useCanvasBuilderStore((s) => s.updateNodeProps);
  const updateNodeStyles = useCanvasBuilderStore((s) => s.updateNodeStyles);
  const updateNodeMetadata = useCanvasBuilderStore((s) => s.updateNodeMetadata);
  const removeNode = useCanvasBuilderStore((s) => s.removeNode);
  const duplicateNode = useCanvasBuilderStore((s) => s.duplicateNode);
  const getNodePath = useCanvasBuilderStore((s) => s.getNodePath);
  const selectNode = useCanvasBuilderStore((s) => s.selectNode);

  if (!node || !selectedNodeId) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-2 glass-panel"
        style={{ borderLeft: "1px solid var(--glass-border)", borderRadius: 0 }}
      >
        <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
          Properties
        </div>
        <p className="px-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          Select an element to edit its properties
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col glass-panel"
      style={{ borderLeft: "1px solid var(--glass-border)", borderRadius: 0 }}
    >
      <div
        className="flex shrink-0 items-center justify-between px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--studio-border)" }}
      >
        <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
          Properties
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => duplicateNode(selectedNodeId)}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold transition hover:bg-white/8"
            style={{ color: "var(--text-muted)" }}
            title="Duplicate (⌘D)"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => removeNode(selectedNodeId)}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold transition hover:bg-red-500/10"
            style={{ color: "#ef4444" }}
            title="Delete (Del)"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Breadcrumb */}
        <div className="mb-3 flex flex-wrap items-center gap-1 text-[9px] font-bold">
          {getNodePath(selectedNodeId).map((n, i, arr) => (
            <span key={n.id} className="flex items-center gap-1">
              <button
                onClick={() => selectNode(n.id)}
                style={{
                  color: i === arr.length - 1 ? "var(--glass-purple)" : "var(--glass-text-3)",
                  cursor: "pointer",
                }}
              >
                {n.metadata.name || n.type}
              </button>
              {i < arr.length - 1 && <span style={{ color: "var(--glass-text-3)" }}>/</span>}
            </span>
          ))}
        </div>

        {/* Node type badge */}
        <div className="mb-3 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold" style={{ borderColor: "var(--glass-border)", color: "var(--glass-text-2)" }}>
          {node.type.toUpperCase()} · <span style={{ color: "var(--glass-text-3)" }}>{node.id.slice(0, 12)}</span>
        </div>

        <div className="space-y-3">
          {/* Content section */}
          {(node.type === "heading" || node.type === "text" || node.type === "button") && (
            <CollapsibleSection title="Content">
              <Field label="Text">
                <input
                  type="text"
                  value={node.props.text ?? ""}
                  onChange={(e) => updateNodeProps(selectedNodeId, { text: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              {node.type === "heading" && (
                <Field label="Level">
                  <select
                    value={node.props.level ?? 2}
                    onChange={(e) => updateNodeProps(selectedNodeId, { level: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 | 6 })}
                    style={inputStyle}
                  >
                    {[1, 2, 3, 4, 5, 6].map((l) => (
                      <option key={l} value={l}>H{l}</option>
                    ))}
                  </select>
                </Field>
              )}
              {node.type === "button" && (
                <Field label="Link (href)">
                  <input
                    type="text"
                    value={node.props.href ?? ""}
                    onChange={(e) => updateNodeProps(selectedNodeId, { href: e.target.value })}
                    style={inputStyle}
                    placeholder="https://..."
                  />
                </Field>
              )}
            </CollapsibleSection>
          )}

          {node.type === "image" && (
            <CollapsibleSection title="Content">
              <Field label="Image URL">
                <input
                  type="text"
                  value={node.props.src ?? ""}
                  onChange={(e) => updateNodeProps(selectedNodeId, { src: e.target.value })}
                  style={inputStyle}
                  placeholder="https://..."
                />
              </Field>
              <Field label="Alt text">
                <input
                  type="text"
                  value={node.props.alt ?? ""}
                  onChange={(e) => updateNodeProps(selectedNodeId, { alt: e.target.value })}
                  style={inputStyle}
                />
              </Field>
            </CollapsibleSection>
          )}

          {node.type === "input" && (
            <CollapsibleSection title="Content">
              <Field label="Placeholder">
                <input
                  type="text"
                  value={node.props.placeholder ?? ""}
                  onChange={(e) => updateNodeProps(selectedNodeId, { placeholder: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Input type">
                <select
                  value={node.props.inputType ?? "text"}
                  onChange={(e) => updateNodeProps(selectedNodeId, { inputType: e.target.value })}
                  style={inputStyle}
                >
                  <option value="text">Text</option>
                  <option value="email">Email</option>
                  <option value="password">Password</option>
                  <option value="number">Number</option>
                  <option value="tel">Tel</option>
                  <option value="url">URL</option>
                </select>
              </Field>
              <Field label="Name">
                <input
                  type="text"
                  value={node.props.inputName ?? ""}
                  onChange={(e) => updateNodeProps(selectedNodeId, { inputName: e.target.value })}
                  style={inputStyle}
                />
              </Field>
            </CollapsibleSection>
          )}

          {node.type === "columns" && (
            <CollapsibleSection title="Content">
              <Field label="Columns">
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={node.props.columns ?? 2}
                  onChange={(e) => updateNodeProps(selectedNodeId, { columns: Number(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
            </CollapsibleSection>
          )}

          {/* Layout section */}
          <CollapsibleSection title="Layout">
            <Field label="Width">
              <input
                type="text"
                value={node.styles.width ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { width: e.target.value })}
                style={inputStyle}
                placeholder="auto"
              />
            </Field>
            <Field label="Height">
              <input
                type="text"
                value={node.styles.height ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { height: e.target.value })}
                style={inputStyle}
                placeholder="auto"
              />
            </Field>
            <Field label="Display">
              <select
                value={node.styles.display ?? "block"}
                onChange={(e) => updateNodeStyles(selectedNodeId, { display: e.target.value })}
                style={inputStyle}
              >
                <option value="block">Block</option>
                <option value="flex">Flex</option>
                <option value="inline">Inline</option>
                <option value="none">None</option>
              </select>
            </Field>
            <Field label="Direction">
              <select
                value={node.styles.flexDirection ?? "column"}
                onChange={(e) => updateNodeStyles(selectedNodeId, { flexDirection: e.target.value as "row" | "column" })}
                style={inputStyle}
              >
                <option value="column">Column</option>
                <option value="row">Row</option>
              </select>
            </Field>
            <Field label="Align items">
              <select
                value={node.styles.alignItems ?? "stretch"}
                onChange={(e) => updateNodeStyles(selectedNodeId, { alignItems: e.target.value })}
                style={inputStyle}
              >
                <option value="stretch">Stretch</option>
                <option value="flex-start">Start</option>
                <option value="center">Center</option>
                <option value="flex-end">End</option>
              </select>
            </Field>
            <Field label="Justify">
              <select
                value={node.styles.justifyContent ?? "flex-start"}
                onChange={(e) => updateNodeStyles(selectedNodeId, { justifyContent: e.target.value })}
                style={inputStyle}
              >
                <option value="flex-start">Start</option>
                <option value="center">Center</option>
                <option value="flex-end">End</option>
                <option value="space-between">Between</option>
                <option value="space-around">Around</option>
              </select>
            </Field>
          </CollapsibleSection>

          {/* Spacing section */}
          <CollapsibleSection title="Spacing">
            <Field label="Padding">
              <input
                type="text"
                value={node.styles.padding ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { padding: e.target.value })}
                style={inputStyle}
                placeholder="0px"
              />
            </Field>
            <Field label="Margin">
              <input
                type="text"
                value={node.styles.margin ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { margin: e.target.value })}
                style={inputStyle}
                placeholder="0px"
              />
            </Field>
            <Field label="Gap">
              <input
                type="number"
                value={node.styles.gap ?? 0}
                onChange={(e) => updateNodeStyles(selectedNodeId, { gap: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label="Radius">
              <input
                type="number"
                value={node.styles.borderRadius ?? 0}
                onChange={(e) => updateNodeStyles(selectedNodeId, { borderRadius: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
          </CollapsibleSection>

          {/* Typography section */}
          {(node.type === "heading" || node.type === "text" || node.type === "button" || node.type === "input") && (
            <CollapsibleSection title="Typography">
              <Field label="Font size">
                <input
                  type="number"
                  value={node.styles.fontSize ?? 14}
                  onChange={(e) => updateNodeStyles(selectedNodeId, { fontSize: Number(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Font weight">
                <select
                  value={node.styles.fontWeight ?? "400"}
                  onChange={(e) => updateNodeStyles(selectedNodeId, { fontWeight: e.target.value })}
                  style={inputStyle}
                >
                  <option value="300">Light</option>
                  <option value="400">Regular</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                  <option value="700">Bold</option>
                  <option value="800">Extrabold</option>
                  <option value="900">Black</option>
                </select>
              </Field>
              <Field label="Text color">
                <input
                  type="text"
                  value={node.styles.color ?? ""}
                  onChange={(e) => updateNodeStyles(selectedNodeId, { color: e.target.value })}
                  style={inputStyle}
                  placeholder="var(--text-primary)"
                />
              </Field>
              <Field label="Align">
                <select
                  value={node.styles.textAlign ?? "left"}
                  onChange={(e) => updateNodeStyles(selectedNodeId, { textAlign: e.target.value as "left" | "center" | "right" })}
                  style={inputStyle}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </Field>
            </CollapsibleSection>
          )}

          {/* Appearance section */}
          <CollapsibleSection title="Appearance">
            <Field label="Background">
              <input
                type="text"
                value={node.styles.backgroundColor ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { backgroundColor: e.target.value })}
                style={inputStyle}
                placeholder="transparent"
              />
            </Field>
            <Field label="Border width">
              <input
                type="number"
                value={node.styles.borderWidth ?? 0}
                onChange={(e) => updateNodeStyles(selectedNodeId, { borderWidth: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label="Border color">
              <input
                type="text"
                value={node.styles.borderColor ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { borderColor: e.target.value })}
                style={inputStyle}
                placeholder="var(--studio-border)"
              />
            </Field>
            <Field label="Opacity">
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={node.styles.opacity ?? 1}
                onChange={(e) => updateNodeStyles(selectedNodeId, { opacity: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>
            <Field label="Visible">
              <select
                value={node.styles.visible === false ? "hidden" : "visible"}
                onChange={(e) => updateNodeStyles(selectedNodeId, { visible: e.target.value === "visible" })}
                style={inputStyle}
              >
                <option value="visible">Visible</option>
                <option value="hidden">Hidden</option>
              </select>
            </Field>
          </CollapsibleSection>

          {/* Effects section */}
          <CollapsibleSection title="Effects" defaultOpen={false}>
            <Field label="Box shadow">
              <input
                type="text"
                value={node.styles.boxShadow ?? ""}
                onChange={(e) => updateNodeStyles(selectedNodeId, { boxShadow: e.target.value })}
                style={inputStyle}
                placeholder="0 4px 12px rgba(0,0,0,0.1)"
              />
            </Field>
          </CollapsibleSection>

          {/* Advanced section */}
          <CollapsibleSection title="Advanced" defaultOpen={false}>
            <Field label="Name">
              <input
                type="text"
                value={node.metadata.name ?? ""}
                onChange={(e) => updateNodeMetadata(selectedNodeId, { name: e.target.value })}
                style={inputStyle}
                placeholder="Hero Section"
              />
            </Field>
            <Field label="Locked">
              <select
                value={node.metadata.locked ? "locked" : "unlocked"}
                onChange={(e) => updateNodeMetadata(selectedNodeId, { locked: e.target.value === "locked" })}
                style={inputStyle}
              >
                <option value="unlocked">Unlocked</option>
                <option value="locked">Locked</option>
              </select>
            </Field>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
