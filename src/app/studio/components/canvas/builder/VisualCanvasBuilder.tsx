"use client";

import { useEffect, useCallback } from "react";
import { FileCode, FileType2, FileJson, type LucideIcon } from "lucide-react";
import { ComponentPalette } from "./ComponentPalette";
import { CanvasStage } from "./CanvasStage";
import { CanvasToolbar } from "./CanvasToolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { ProjectTypeSelector } from "./ProjectTypeSelector";
import { HtmlProjectEditor } from "./HtmlProjectEditor";
import { useCanvasBuilderStore } from "./store";
import { getProjectTypeMeta } from "./projectTypes";

const HTML_FILE_ICONS: Record<string, LucideIcon> = {
  "index.html": FileCode,
  "style.css": FileType2,
  "script.js": FileJson,
};

/** File list for HTML project mode — shown below the project type selector */
function HtmlFileList() {
  const htmlProject = useCanvasBuilderStore((s) => s.htmlProject);
  const setActiveHtmlFile = useCanvasBuilderStore((s) => s.setActiveHtmlFile);

  return (
    <div className="flex flex-col" style={{ borderTop: "1px solid var(--glass-border)" }}>
      <div className="px-3 py-2 text-[9px] font-black uppercase tracking-[0.1em]" style={{ color: "var(--glass-text-3)" }}>
        Files
      </div>
      {htmlProject.files.map((file) => {
        const Icon = HTML_FILE_ICONS[file.name] ?? FileCode;
        const isActive = file.name === htmlProject.activeFile;
        return (
          <button
            key={file.name}
            type="button"
            onClick={() => setActiveHtmlFile(file.name)}
            className="flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
            style={{
              background: isActive ? "rgba(155,77,255,0.08)" : "transparent",
            }}
          >
            <Icon size={12} style={{ color: isActive ? "var(--glass-purple)" : "var(--glass-text-3)" }} />
            <span
              className="text-[11px] font-medium"
              style={{ color: isActive ? "var(--text-primary)" : "var(--glass-text-3)" }}
            >
              {file.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function VisualCanvasBuilder() {
  const loadDocument = useCanvasBuilderStore((s) => s.loadDocument);
  const selectedNodeId = useCanvasBuilderStore((s) => s.selectedNodeId);
  const removeNode = useCanvasBuilderStore((s) => s.removeNode);
  const copyNode = useCanvasBuilderStore((s) => s.copyNode);
  const pasteNode = useCanvasBuilderStore((s) => s.pasteNode);
  const duplicateNode = useCanvasBuilderStore((s) => s.duplicateNode);
  const undo = useCanvasBuilderStore((s) => s.undo);
  const redo = useCanvasBuilderStore((s) => s.redo);
  const selectNode = useCanvasBuilderStore((s) => s.selectNode);
  const document = useCanvasBuilderStore((s) => s.document);
  const nudgeNode = useCanvasBuilderStore((s) => s.nudgeNode);
  const tool = useCanvasBuilderStore((s) => s.tool);
  const setTool = useCanvasBuilderStore((s) => s.setTool);
  const projectType = useCanvasBuilderStore((s) => s.projectType);

  // Load persisted document on mount
  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't interfere with input fields
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) {
      return;
    }

    const cmd = e.metaKey || e.ctrlKey;

    if (cmd && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (cmd && (e.key === "z" && e.shiftKey || e.key === "y")) {
      e.preventDefault();
      redo();
    } else if (cmd && e.key === "c") {
      if (selectedNodeId) {
        e.preventDefault();
        copyNode(selectedNodeId);
      }
    } else if (cmd && e.key === "v") {
      e.preventDefault();
      const rootId = document.rootNodeIds[0];
      if (rootId) pasteNode(rootId);
    } else if (cmd && e.key === "d") {
      if (selectedNodeId) {
        e.preventDefault();
        duplicateNode(selectedNodeId);
      }
    } else if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
      e.preventDefault();
      removeNode(selectedNodeId);
    } else if (e.key === "Escape") {
      e.preventDefault();
      selectNode(null);
    } else if (e.key === "v" && !cmd) {
      setTool("select");
    } else if (e.key === "h" && !cmd) {
      setTool("pan");
    } else if (e.key === "ArrowUp" && selectedNodeId) {
      e.preventDefault();
      nudgeNode(selectedNodeId, 0, e.shiftKey ? -10 : -1);
    } else if (e.key === "ArrowDown" && selectedNodeId) {
      e.preventDefault();
      nudgeNode(selectedNodeId, 0, e.shiftKey ? 10 : 1);
    } else if (e.key === "ArrowLeft" && selectedNodeId) {
      e.preventDefault();
      nudgeNode(selectedNodeId, e.shiftKey ? -10 : -1, 0);
    } else if (e.key === "ArrowRight" && selectedNodeId) {
      e.preventDefault();
      nudgeNode(selectedNodeId, e.shiftKey ? 10 : 1, 0);
    }
  }, [selectedNodeId, removeNode, copyNode, pasteNode, duplicateNode, undo, redo, selectNode, document.rootNodeIds, nudgeNode, tool, setTool]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const typeMeta = getProjectTypeMeta(projectType);

  // HTML/CSS/JS mode — render the file editor with live preview
  if (typeMeta.editor === "html") {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
        {/* Left: Project type selector (narrow) */}
        <div className="flex flex-1 overflow-hidden">
          <div className="shrink-0" style={{ width: 200 }}>
            <ProjectTypeSelector />
            <HtmlFileList />
          </div>
          {/* Center+Right: HTML editor with code + preview */}
          <HtmlProjectEditor />
        </div>
      </div>
    );
  }

  // Game mode — placeholder for Phase 2
  if (typeMeta.editor === "game") {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
        <div className="flex flex-1 overflow-hidden">
          <div className="shrink-0" style={{ width: 200 }}>
            <ProjectTypeSelector />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
                Game Studio
              </div>
              <div className="text-sm" style={{ color: "var(--glass-text-3)" }}>
                Coming in Phase 2 — Quick Build, visual editor, and playable preview.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Website / App / Component mode — the visual canvas builder
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
      {/* Top toolbar */}
      <CanvasToolbar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Project type selector + Component Palette */}
        <div className="shrink-0" style={{ width: 200 }}>
          <ProjectTypeSelector />
          <ComponentPalette />
        </div>

        {/* Center: Canvas Stage */}
        <CanvasStage />

        {/* Right: Properties Panel */}
        <div className="shrink-0" style={{ width: 280 }}>
          <PropertiesPanel />
        </div>
      </div>
    </div>
  );
}
