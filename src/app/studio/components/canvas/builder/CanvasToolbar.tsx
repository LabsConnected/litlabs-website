"use client";

import {
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
  Monitor,
  Tablet,
  Smartphone,
  Eye,
  Save,
  ZoomIn,
  ZoomOut,
  Maximize,
  Sparkles,
  Code2,
  Globe,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import type { Breakpoint } from "./types";

export function CanvasToolbar() {
  const undo = useCanvasBuilderStore((s) => s.undo);
  const redo = useCanvasBuilderStore((s) => s.redo);
  const canUndo = useCanvasBuilderStore((s) => s.historyIndex > 0);
  const canRedo = useCanvasBuilderStore((s) => s.historyIndex < s.history.length - 1);
  const tool = useCanvasBuilderStore((s) => s.tool);
  const setTool = useCanvasBuilderStore((s) => s.setTool);
  const breakpoint = useCanvasBuilderStore((s) => s.breakpoint);
  const setBreakpoint = useCanvasBuilderStore((s) => s.setBreakpoint);
  const previewMode = useCanvasBuilderStore((s) => s.previewMode);
  const setPreviewMode = useCanvasBuilderStore((s) => s.setPreviewMode);
  const zoom = useCanvasBuilderStore((s) => s.zoom);
  const setZoom = useCanvasBuilderStore((s) => s.setZoom);
  const saveDocument = useCanvasBuilderStore((s) => s.saveDocument);
  const document = useCanvasBuilderStore((s) => s.document);
  const setRightPanelTab = useCanvasBuilderStore((s) => s.setRightPanelTab);

  const btnBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 28,
    minWidth: 28,
    padding: "0 6px",
    borderRadius: 6,
    border: "1px solid transparent",
    backgroundColor: "transparent",
    color: "var(--glass-text-2)",
    cursor: "pointer",
    transition: "all 0.12s ease",
    fontSize: 10,
    fontWeight: 700,
  };

  const btnActive: React.CSSProperties = {
    ...btnBase,
    backgroundColor: "var(--glass-purple-soft)",
    borderColor: "var(--glass-border-purple)",
    color: "var(--glass-purple)",
  };

  const btnHover: React.CSSProperties = {
    ...btnBase,
    backgroundColor: "rgba(255,255,255,0.06)",
  };

  const breakpoints: { id: Breakpoint; icon: typeof Monitor; label: string }[] = [
    { id: "desktop", icon: Monitor, label: "Desktop" },
    { id: "tablet", icon: Tablet, label: "Tablet" },
    { id: "mobile", icon: Smartphone, label: "Mobile" },
  ];

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 h-10 glass-toolbar"
      style={{ borderBottom: "1px solid var(--glass-border)", borderRadius: 0 }}
    >
      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={undo}
          disabled={!canUndo}
          style={canUndo ? btnHover : { ...btnBase, opacity: 0.3, cursor: "not-allowed" }}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          style={canRedo ? btnHover : { ...btnBase, opacity: 0.3, cursor: "not-allowed" }}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={14} />
        </button>
      </div>

      <div style={{ width: 1, height: 16, backgroundColor: "var(--glass-border)" }} />

      {/* Tools */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setTool("select")}
          style={tool === "select" ? btnActive : btnHover}
          title="Select tool (V)"
        >
          <MousePointer2 size={14} />
        </button>
        <button
          onClick={() => setTool("pan")}
          style={tool === "pan" ? btnActive : btnHover}
          title="Pan tool (H)"
        >
          <Hand size={14} />
        </button>
      </div>

      <div style={{ width: 1, height: 16, backgroundColor: "var(--glass-border)" }} />

      {/* Breakpoints */}
      <div className="flex items-center gap-0.5">
        {breakpoints.map((bp) => {
          const Icon = bp.icon;
          return (
            <button
              key={bp.id}
              onClick={() => setBreakpoint(bp.id)}
              style={breakpoint === bp.id ? btnActive : btnHover}
              title={bp.label}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>

      <div style={{ width: 1, height: 16, backgroundColor: "var(--glass-border)" }} />

      {/* Zoom */}
      <div className="flex items-center gap-0.5">
        <button onClick={() => setZoom(zoom - 10)} style={btnHover} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--glass-text-2)", minWidth: 36, textAlign: "center" }}>
          {zoom}%
        </span>
        <button onClick={() => setZoom(zoom + 10)} style={btnHover} title="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => setZoom(100)} style={btnHover} title="100%">
          <Maximize size={12} />
        </button>
      </div>

      <div className="flex-1" />

      {/* Ask LiTT */}
      <button
        onClick={() => setRightPanelTab("litt")}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-[10px] font-bold transition"
        style={{
          backgroundColor: "var(--glass-purple-soft)",
          border: "1px solid var(--glass-border-purple)",
          color: "var(--glass-purple)",
          cursor: "pointer",
        }}
        title="Ask LiTT to build, redesign, or improve"
      >
        <Sparkles size={12} />
        Ask LiTT...
      </button>

      {/* Save status */}
      <span style={{ fontSize: 9, fontWeight: 600, color: "var(--glass-text-3)" }}>
        v{document.version} · saved
      </span>

      {/* Build / Preview / Live mode toggle */}
      <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
        <button
          onClick={() => setPreviewMode(false)}
          style={!previewMode ? btnActive : { ...btnBase, backgroundColor: "transparent", border: "none" }}
          title="Build mode — edit blocks, drag/drop, inline edit"
        >
          <Code2 size={12} style={{ display: "inline" }} />
          <span style={{ marginLeft: 4 }}>Build</span>
        </button>
        <button
          onClick={() => setPreviewMode(true)}
          style={previewMode ? btnActive : { ...btnBase, backgroundColor: "transparent", border: "none" }}
          title="Preview mode — real site render in iframe"
        >
          <Eye size={12} style={{ display: "inline" }} />
          <span style={{ marginLeft: 4 }}>Preview</span>
        </button>
      </div>

      {/* Save */}
      <button
        onClick={saveDocument}
        style={btnHover}
        title="Save"
      >
        <Save size={14} />
      </button>
    </div>
  );
}
