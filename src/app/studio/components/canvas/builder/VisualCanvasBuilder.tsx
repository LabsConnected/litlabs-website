"use client";

import { useEffect, useCallback, useState } from "react";
import { FileCode, FileType2, FileJson, PanelLeftClose, PanelRightClose, PanelLeftOpen, PanelRightOpen, type LucideIcon } from "lucide-react";
import { ComponentPalette } from "./ComponentPalette";
import { CanvasStage } from "./CanvasStage";
import { CanvasToolbar } from "./CanvasToolbar";
import { PropertiesPanel } from "./PropertiesPanel";
import { ProjectTypeSelector } from "./ProjectTypeSelector";
import { HtmlProjectEditor } from "./HtmlProjectEditor";
import { useCanvasBuilderStore } from "./store";
import { getProjectTypeMeta, type ProjectType } from "./projectTypes";
import { useConnectionSummary } from "@/app/studio/hooks/useConnectionSummary";

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
  const setProjectType = useCanvasBuilderStore((s) => s.setProjectType);

  // Server-backed project ID for loading persisted workspace type
  const { capabilities } = useConnectionSummary();
  const serverProjectId = capabilities.projectId ?? null;

  // Load persisted document on mount
  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  // Load project type from server when the active project changes
  // The server stores the workspace type in the dedicated `workspace_type` column
  useEffect(() => {
    if (!serverProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/studio-projects/${serverProjectId}`);
        if (!res.ok) return;
        const data = await res.json();
        const workspaceType = data.project?.workspaceType;
        const validTypes: ProjectType[] = ["website", "html", "game2d", "game3d", "app", "component"];
        if (workspaceType && validTypes.includes(workspaceType as ProjectType) && !cancelled) {
          setProjectType(workspaceType as ProjectType);
        }
      } catch {
        // Non-fatal — localStorage fallback still has the type
      }
    })();
    return () => { cancelled = true; };
  }, [serverProjectId, setProjectType]);

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

  // Collapsible palette/inspector — overlays instead of permanently consuming width
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // HTML/CSS/JS mode — render the file editor with live preview
  if (typeMeta.editor === "html") {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Project type selector (narrow) — collapsible */}
          {paletteOpen && (
            <div className="shrink-0" style={{ width: 200 }}>
              <ProjectTypeSelector />
              <HtmlFileList />
            </div>
          )}
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
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
      {/* Top toolbar with palette/inspector toggle buttons */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1" style={{ borderColor: "var(--studio-border)" }}>
        <CanvasToolbar />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition hover:bg-white/10"
          style={{ color: paletteOpen ? "var(--litt-primary)" : "var(--text-muted)" }}
          aria-label={paletteOpen ? "Hide palette" : "Show palette"}
          aria-pressed={paletteOpen}
        >
          {paletteOpen ? <PanelLeftClose size={12} className="pointer-events-none" /> : <PanelLeftOpen size={12} className="pointer-events-none" />}
          Components
        </button>
        <button
          type="button"
          onClick={() => setInspectorOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition hover:bg-white/10"
          style={{ color: inspectorOpen ? "var(--litt-primary)" : "var(--text-muted)" }}
          aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
          aria-pressed={inspectorOpen}
        >
          {inspectorOpen ? <PanelRightClose size={12} className="pointer-events-none" /> : <PanelRightOpen size={12} className="pointer-events-none" />}
          Inspector
        </button>
      </div>

      {/* Canvas area — palette and inspector are overlays, not permanent columns */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Palette overlay — left side, absolute positioned */}
        {paletteOpen && (
          <div
            className="absolute left-0 top-0 bottom-0 z-20 shrink-0 overflow-y-auto border-r"
            style={{
              width: 200,
              backgroundColor: "rgba(10,11,16,0.95)",
              borderColor: "var(--studio-border)",
              backdropFilter: "blur(8px)",
            }}
          >
            <ProjectTypeSelector />
            <ComponentPalette />
          </div>
        )}

        {/* Center: Canvas Stage — always full width */}
        <CanvasStage />

        {/* Inspector overlay — right side, absolute positioned */}
        {inspectorOpen && (
          <div
            className="absolute right-0 top-0 bottom-0 z-20 shrink-0 overflow-y-auto border-l"
            style={{
              width: 280,
              backgroundColor: "rgba(10,11,16,0.95)",
              borderColor: "var(--studio-border)",
              backdropFilter: "blur(8px)",
            }}
          >
            <PropertiesPanel />
          </div>
        )}
      </div>
    </div>
  );
}
