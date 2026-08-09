"use client";

import { useRef, useCallback, useState } from "react";
import { useCanvasBuilderStore } from "./store";
import { NodeRenderer } from "./NodeRenderer";
import type { CanvasNode, NodeType } from "./types";
import { createNode, PALETTE_ITEMS } from "./types";

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

  const handleSelect = useCallback((id: string, e: React.MouseEvent) => {
    selectNode(id);
  }, [selectNode]);

  const handleDragStart = useCallback((id: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-canvas-move-id", id);
    setDragSource({ type: node.type, fromPalette: false, nodeId: id });
  }, [node.type, setDragSource]);

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
    const isContainer = canHaveChildren(node.type);

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
      index = targetNode.children.length;
    } else if (targetNode.parentId) {
      const parent = useCanvasBuilderStore.getState().document.nodes[targetNode.parentId];
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
      >
        {node.children.length > 0 && (
          <div style={{ display: "flex", flexDirection: node.styles.flexDirection ?? "column", gap: node.styles.gap ?? 0 }}>
            {node.children.map((childId) => (
              <TreeNodeView key={childId} nodeId={childId} />
            ))}
          </div>
        )}
      </NodeRenderer>
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
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragOverStage, setDragOverStage] = useState(false);

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

  return (
    <div
      ref={stageRef}
      className="relative flex-1 overflow-auto"
      style={{
        backgroundColor: dragOverStage ? "rgba(155,77,255,0.03)" : "#0a0b10",
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
        backgroundSize: "20px 20px",
      }}
      onClick={handleStageClick}
      onDragOver={handleStageDragOver}
      onDragLeave={handleStageDragLeave}
      onDrop={handleCombinedDrop}
    >
      <div style={{ minHeight: "100%", padding: "24px", maxWidth: 900, margin: "0 auto" }}>
        {rootId && <TreeNodeView nodeId={rootId} />}
      </div>

      {document.nodes[rootId]?.children.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ top: 64 }}
        >
          <div className="text-center" style={{ color: "var(--text-muted)" }}>
            <div className="text-[13px] font-bold mb-1">Drop components here</div>
            <div className="text-[11px]">Drag from the left panel or drop image files</div>
          </div>
        </div>
      )}
    </div>
  );
}
