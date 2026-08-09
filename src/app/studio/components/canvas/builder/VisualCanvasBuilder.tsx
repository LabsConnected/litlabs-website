"use client";

import { useEffect, useCallback } from "react";
import { ComponentPalette } from "./ComponentPalette";
import { CanvasStage } from "./CanvasStage";
import { PropertiesPanel } from "./PropertiesPanel";
import { useCanvasBuilderStore } from "./store";

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
    }
  }, [selectedNodeId, removeNode, copyNode, pasteNode, duplicateNode, undo, redo, selectNode, document.rootNodeIds]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
      {/* Left: Component Palette */}
      <div className="shrink-0" style={{ width: 180 }}>
        <ComponentPalette />
      </div>

      {/* Center: Canvas Stage */}
      <CanvasStage />

      {/* Right: Properties Panel */}
      <div className="shrink-0" style={{ width: 260 }}>
        <PropertiesPanel />
      </div>
    </div>
  );
}
