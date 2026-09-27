"use client";

import { useRef, useCallback, useState, useMemo, useEffect, useLayoutEffect } from "react";
import { Sparkles, Plus } from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import { NodeRenderer } from "./NodeRenderer";
import type { NodeType } from "./types";
import { createNode, PALETTE_ITEMS, SECTION_TEMPLATES, BREAKPOINT_WIDTHS } from "./types";
import { EmptyCanvasGreeter } from "./EmptyCanvasGreeter";
import { canvasToHtml } from "./canvas-to-html";
import { SelectionChrome, type SelectionGesture } from "../SelectionChrome";
import { applyGesture, measureElementBox, zoomPercentByWheel, type Box } from "../direct-manipulation";

function SelectedNodeChrome({ nodeId }: { nodeId: string }) {
  const zoom = useCanvasBuilderStore((s) => s.zoom);
  const commitNodeBox = useCanvasBuilderStore((s) => s.commitNodeBox);
  const left = useCanvasBuilderStore((s) => s.document.nodes[nodeId]?.styles.left);
  const top = useCanvasBuilderStore((s) => s.document.nodes[nodeId]?.styles.top);
  const width = useCanvasBuilderStore((s) => s.document.nodes[nodeId]?.styles.width);
  const height = useCanvasBuilderStore((s) => s.document.nodes[nodeId]?.styles.height);
  const [box, setBox] = useState<Box | null>(null);
  const origin = useRef<Box | null>(null);
  const pushed = useRef(false);

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (!(el instanceof HTMLElement)) return null;
    const measured = measureElementBox(el, zoom / 100);
    if (measured.width < 1 || measured.height < 1) return null;
    return measured;
  }, [nodeId, zoom]);

  useLayoutEffect(() => {
    if (origin.current) return;
    setBox(measure());
  }, [measure, left, top, width, height]);

  const onGesture = (gesture: SelectionGesture) => {
    if (gesture.phase === "start") {
      origin.current = measure() ?? box;
      pushed.current = false;
      return;
    }
    const start = origin.current;
    if (!start) return;
    const next = applyGesture(start, gesture.kind, gesture.dx, gesture.dy, gesture.shiftKey);
    setBox(next);
    const unchanged = Math.round(next.x) === Math.round(start.x)
      && Math.round(next.y) === Math.round(start.y)
      && Math.round(next.width) === Math.round(start.width)
      && Math.round(next.height) === Math.round(start.height);
    if (gesture.phase === "end") {
      origin.current = null;
      if (!unchanged) commitNodeBox(nodeId, next, pushed.current ? "replace" : "push");
      return;
    }
    if (!unchanged) {
      commitNodeBox(nodeId, next, pushed.current ? "replace" : "push");
      pushed.current = true;
    }
  };

  if (!box) return null;
  return <SelectionChrome box={box} zoom={zoom / 100} onGesture={onGesture} />;
}

function canHaveChildren(type: NodeType): boolean {
  return PALETTE_ITEMS.find((p) => p.type === type)?.canHaveChildren ?? false;
}

function TreeNodeView({ nodeId }: { nodeId: string }) {
  const node = useCanvasBuilderStore((s) => s.document.nodes[nodeId]);
  const selectedNodeId = useCanvasBuilderStore((s) => s.selectedNodeId);
  const selectNode = useCanvasBuilderStore((s) => s.selectNode);
  const setDragSource = useCanvasBuilderStore((s) => s.setDragSource);
  const setDropTarget = useCanvasBuilderStore((s) => s.setDropTarget);
  const dropTargetId = useCanvasBuilderStore((s) => s.dropTargetId);
  const dropPosition = useCanvasBuilderStore((s) => s.dropPosition);
  const addNodeObject = useCanvasBuilderStore((s) => s.addNodeObject);
  const moveNode = useCanvasBuilderStore((s) => s.moveNode);
  const dragSource = useCanvasBuilderStore((s) => s.dragSource);
  const updateNodeProps = useCanvasBuilderStore((s) => s.updateNodeProps);
  const tool = useCanvasBuilderStore((s) => s.tool);

  const handleSelect = useCallback((id: string, e: React.MouseEvent) => {
    selectNode(id);
  }, [selectNode]);

  const handleInlineEdit = useCallback((nodeId: string, text: string) => {
    updateNodeProps(nodeId, { text });
  }, [updateNodeProps]);

  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-canvas-move-id", id);
    setDragSource({ type: node?.type ?? "div", fromPalette: false, nodeId: id });
  }, [node?.type, setDragSource]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTarget(null, null);
  }, [setDragSource, setDropTarget]);

  if (!node) return null;

  const isSelected = selectedNodeId === nodeId;
  const isDropTarget = dropTargetId === nodeId;
  const isDropInside = isDropTarget && dropPosition === "inside";
  const isDropBefore = isDropTarget && dropPosition === "before";
  const isDropAfter = isDropTarget && dropPosition === "after";

  const dropIndicatorStyle: React.CSSProperties = isDropBefore
    ? { boxShadow: "inset 0 2px 0 0 #9b4dff" }
    : isDropAfter
      ? { boxShadow: "inset 0 -2px 0 0 #9b4dff" }
      : isDropInside
        ? { boxShadow: "inset 0 0 0 2px #9b4dff" }
        : {};

  const handleDragOver = (e: React.DragEvent) => {
    if (!dragSource) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dragSource.fromPalette ? "copy" : "move";

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const isContainer = canHaveChildren(node?.type ?? "div");

    if (isContainer) {
      // For containers, top 25% = before, bottom 25% = after, middle = inside
      if (y < h * 0.25 && node.parentId) {
        setDropTarget(nodeId, "before");
      } else if (y > h * 0.75 && node.parentId) {
        setDropTarget(nodeId, "after");
      } else {
        setDropTarget(nodeId, "inside");
      }
    } else if (node.parentId) {
      // For leaf nodes, top half = before, bottom half = after
      if (y < h * 0.5) {
        setDropTarget(nodeId, "before");
      } else {
        setDropTarget(nodeId, "after");
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!dragSource) return;
    e.preventDefault();
    e.stopPropagation();

    const targetType = e.dataTransfer.getData("application/x-canvas-node-type") as NodeType;
    const moveId = e.dataTransfer.getData("application/x-canvas-move-id");

    const targetNode = useCanvasBuilderStore.getState().document.nodes[nodeId];
    if (!targetNode) return;

    // Determine where to insert
    let parentId: string | null = null;
    let index: number | undefined;

    if (dropPosition === "inside" && canHaveChildren(targetNode.type)) {
      parentId = targetNode.id;
      index = targetNode.children?.length ?? 0;
    } else if (targetNode.parentId) {
      const parent = useCanvasBuilderStore.getState().document.nodes[targetNode.parentId];
      if (!parent) {
        setDropTarget(null, null);
        return;
      }
      parentId = parent.id;
      const idx = parent.children.indexOf(targetNode.id);
      index = dropPosition === "after" ? idx + 1 : idx;
    }

    if (!parentId) return;

    if (dragSource.fromPalette && targetType) {
      const newNode = createNode(targetType);
      addNodeObject(newNode, parentId, index);
    } else if (!dragSource.fromPalette && moveId) {
      // Don't drop on self or descendant
      if (moveId === nodeId) return;
      moveNode(moveId, parentId, index);
    }

    setDropTarget(null, null);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving to outside this element
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    if (dropTargetId === nodeId) {
      setDropTarget(null, null);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
      style={{ position: "relative", ...dropIndicatorStyle }}
    >
      <NodeRenderer
        node={node}
        isSelected={isSelected}
        onSelect={handleSelect}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onInlineEdit={handleInlineEdit}
      >
        {(node.children?.length ?? 0) > 0 && (
          <div style={{ display: "flex", flexDirection: node.styles?.flexDirection ?? "column", gap: node.styles?.gap ?? 0 }}>
            {node.children.map((childId) => (
              <TreeNodeView key={childId} nodeId={childId} />
            ))}
          </div>
        )}
      </NodeRenderer>
      {isSelected && tool === "select" && !node.metadata?.locked && (
        <SelectedNodeChrome nodeId={nodeId} />
      )}
    </div>
  );
}

export function CanvasStage() {
  const document = useCanvasBuilderStore((s) => s.document);
  const selectNode = useCanvasBuilderStore((s) => s.selectNode);
  const setDropTarget = useCanvasBuilderStore((s) => s.setDropTarget);
  const addNodeObject = useCanvasBuilderStore((s) => s.addNodeObject);
  const moveNode = useCanvasBuilderStore((s) => s.moveNode);
  const dragSource = useCanvasBuilderStore((s) => s.dragSource);
  const dropTargetId = useCanvasBuilderStore((s) => s.dropTargetId);
  const dropPosition = useCanvasBuilderStore((s) => s.dropPosition);
  const zoom = useCanvasBuilderStore((s) => s.zoom);
  const setZoom = useCanvasBuilderStore((s) => s.setZoom);
  const stageTool = useCanvasBuilderStore((s) => s.tool);
  const breakpoint = useCanvasBuilderStore((s) => s.breakpoint);
  const previewMode = useCanvasBuilderStore((s) => s.previewMode);
  const addSectionTemplate = useCanvasBuilderStore((s) => s.addSectionTemplate);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragOverStage, setDragOverStage] = useState(false);
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panDrag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const panMoved = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.key !== " " && event.code !== "Space") return;
      if (event.repeat) return;
      event.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " || event.code === "Space") {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setZoom(zoomPercentByWheel(useCanvasBuilderStore.getState().zoom, event.deltaY));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  const handleStageClick = (e: React.MouseEvent) => {
    if (e.target === stageRef.current) {
      selectNode(null);
    }
  };

  const handleStageDragOver = (e: React.DragEvent) => {
    if (!dragSource) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragSource.fromPalette ? "copy" : "move";
    setDragOverStage(true);
    // If no specific drop target is set, target the root
    if (!dropTargetId) {
      const rootId = document.rootNodeIds[0];
      if (rootId) setDropTarget(rootId, "inside");
    }
  };

  const handleStageDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && stageRef.current?.contains(related)) return;
    setDragOverStage(false);
  };

  const handleStageDrop = (e: React.DragEvent) => {
    if (!dragSource) return;
    // If a child already handled the drop, skip
    if (dropTargetId && dropTargetId !== document.rootNodeIds[0]) {
      setDragOverStage(false);
      return;
    }

    e.preventDefault();
    setDragOverStage(false);

    const targetType = e.dataTransfer.getData("application/x-canvas-node-type") as NodeType;
    const moveId = e.dataTransfer.getData("application/x-canvas-move-id");
    const rootId = document.rootNodeIds[0];
    if (!rootId) return;

    if (dragSource.fromPalette && targetType) {
      const newNode = createNode(targetType);
      addNodeObject(newNode, rootId);
    } else if (!dragSource.fromPalette && moveId && moveId !== rootId) {
      moveNode(moveId, rootId);
    }

    setDropTarget(null, null);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f.name));
    if (imageFiles.length === 0) return;

    e.preventDefault();
    e.stopPropagation();
    setDragOverStage(false);

    const rootId = document.rootNodeIds[0];
    if (!rootId) return;

    for (const file of imageFiles) {
      // For now, create a local object URL. In production, upload to media storage.
      const url = URL.createObjectURL(file);
      const node = createNode("image");
      node.props.src = url;
      node.props.alt = file.name;
      addNodeObject(node, rootId);
    }

    setDropTarget(null, null);
  };

  // Combine drop handlers
  const handleCombinedDrop = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0;
    if (hasFiles) {
      handleFileDrop(e);
    } else {
      handleStageDrop(e);
    }
  };

  const rootId = document.rootNodeIds[0];
  const isEmpty = document.nodes[rootId]?.children.length === 0;
  const bpWidth = BREAKPOINT_WIDTHS[breakpoint];

  // Preview mode: render the canvas as HTML inside an iframe
  const previewHtml = useMemo(() => {
    if (!previewMode) return "";
    return canvasToHtml(document);
  }, [previewMode, document]);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Update iframe srcdoc when previewHtml changes
  useEffect(() => {
    if (previewMode && iframeRef.current) {
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml, previewMode]);

  if (previewMode) {
    return (
      <div
        className="relative flex-1 overflow-auto flex flex-col items-center"
        style={{ backgroundColor: "#0a0b10" }}
      >
        {/* Fake browser bar */}
        <div
          className="flex items-center gap-2 w-full shrink-0 px-3"
          style={{ height: 36, borderBottom: "1px solid var(--glass-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
        >
          <div className="flex gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ff5f57" }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#febc2e" }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#28c840" }} />
          </div>
          <div
            className="flex-1 flex items-center gap-2 rounded-md px-3 py-1 text-[10px] font-mono"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              color: "var(--text-muted)",
              maxWidth: 400,
              margin: "0 auto",
            }}
          >
            <span style={{ opacity: 0.5 }}>🔒</span>
            <span className="truncate">litlabs.net{document.route}</span>
          </div>
          <span className="text-[9px] font-bold" style={{ color: "var(--text-muted)" }}>
            {bpWidth}px
          </span>
        </div>

        {/* Iframe preview */}
        <div className="flex-1 overflow-auto w-full flex justify-center" style={{ padding: "16px" }}>
          <iframe
            ref={iframeRef}
            title="Canvas Preview"
            srcDoc={previewHtml}
            sandbox="allow-same-origin allow-popups allow-forms allow-scripts"
            style={{
              width: `${bpWidth}px`,
              maxWidth: "100%",
              height: "100%",
              minHeight: 500,
              border: "1px solid var(--glass-border)",
              borderRadius: 8,
              backgroundColor: "#0a0b10",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="relative flex-1 overflow-auto"
      style={{
        backgroundColor: dragOverStage ? "rgba(155,77,255,0.03)" : "#0a0b10",
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
        backgroundSize: "20px 20px",
        cursor: spaceHeld || stageTool === "pan" ? "grab" : undefined,
      }}
      onPointerDown={(event) => {
        const panning = event.button === 1 || spaceRef.current || (stageTool === "pan" && event.button === 0);
        if (!panning || !stageRef.current) return;
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
        panMoved.current = false;
        panDrag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: stageRef.current.scrollLeft,
          top: stageRef.current.scrollTop,
        };
      }}
      onPointerMove={(event) => {
        const drag = panDrag.current;
        if (!drag || drag.pointerId !== event.pointerId || !stageRef.current) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) panMoved.current = true;
        stageRef.current.scrollLeft = drag.left - dx;
        stageRef.current.scrollTop = drag.top - dy;
      }}
      onPointerUp={(event) => {
        if (panDrag.current?.pointerId === event.pointerId) panDrag.current = null;
      }}
      onClick={(event) => {
        if (panMoved.current) {
          panMoved.current = false;
          return;
        }
        handleStageClick(event);
      }}
      onDragOver={handleStageDragOver}
      onDragLeave={handleStageDragLeave}
      onDrop={handleCombinedDrop}
    >
      <div
        style={{
          minHeight: "100%",
          padding: "24px",
          margin: "0 auto",
          width: "100%",
          transform: `scale(${zoom / 100})`,
          transformOrigin: "top center",
        }}
      >
        {rootId && <TreeNodeView nodeId={rootId} />}
      </div>

      {isEmpty && <EmptyCanvasGreeter />}
    </div>
  );
}
