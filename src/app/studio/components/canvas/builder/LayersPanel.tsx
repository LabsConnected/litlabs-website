"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";

const NODE_ICONS: Record<string, string> = {
  section: "S",
  container: "C",
  heading: "H",
  text: "T",
  button: "B",
  image: "I",
  card: "D",
  input: "F",
  form: "F",
  columns: "Col",
  spacer: "—",
};

function LayerItem({ nodeId, depth }: { nodeId: string; depth: number }) {
  const node = useCanvasBuilderStore((s) => s.document.nodes[nodeId]);
  const selectedNodeId = useCanvasBuilderStore((s) => s.selectedNodeId);
  const selectNode = useCanvasBuilderStore((s) => s.selectNode);
  const updateNodeMetadata = useCanvasBuilderStore((s) => s.updateNodeMetadata);
  const removeNode = useCanvasBuilderStore((s) => s.removeNode);
  const duplicateNode = useCanvasBuilderStore((s) => s.duplicateNode);
  const [expanded, setExpanded] = useState(true);

  if (!node) return null;

  const isSelected = selectedNodeId === nodeId;
  const hasChildren = node.children.length > 0;
  const isLocked = node.metadata.locked;
  const isHidden = node.metadata.hidden;
  const displayName = node.metadata.name || node.type;

  const iconBtn: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 4,
    border: "none",
    backgroundColor: "transparent",
    cursor: "pointer",
    color: "var(--glass-text-3)",
    transition: "all 0.1s ease",
  };

  return (
    <div>
      <div
        onClick={() => selectNode(nodeId)}
        className="group flex items-center gap-1 rounded-md transition"
        style={{
          paddingLeft: depth * 12 + 4,
          paddingRight: 4,
          height: 26,
          cursor: "pointer",
          backgroundColor: isSelected ? "var(--glass-purple-soft)" : "transparent",
          border: isSelected ? "1px solid var(--glass-border-purple)" : "1px solid transparent",
        }}
      >
        {/* Expand/collapse */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          style={iconBtn}
          className={hasChildren ? "" : "opacity-0"}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Node type badge */}
        <span
          style={{
            fontSize: 8,
            fontWeight: 800,
            textTransform: "uppercase",
            color: "var(--glass-text-3)",
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {NODE_ICONS[node.type] ?? "?"}
        </span>

        {/* Name */}
        <span
          style={{
            fontSize: 11,
            fontWeight: isSelected ? 700 : 500,
            color: isSelected ? "var(--glass-purple)" : isHidden ? "var(--glass-text-3)" : "var(--glass-text-2)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: isHidden ? "line-through" : "none",
          }}
        >
          {displayName}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={(e) => { e.stopPropagation(); updateNodeMetadata(nodeId, { hidden: !isHidden }); }}
            style={iconBtn}
            title={isHidden ? "Show" : "Hide"}
          >
            {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); updateNodeMetadata(nodeId, { locked: !isLocked }); }}
            style={iconBtn}
            title={isLocked ? "Unlock" : "Lock"}
          >
            {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); duplicateNode(nodeId); }}
            style={iconBtn}
            title="Duplicate"
          >
            <Copy size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); removeNode(nodeId); }}
            style={{ ...iconBtn, color: "#ef4444" }}
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((childId) => (
            <LayerItem key={childId} nodeId={childId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayersPanel() {
  const document = useCanvasBuilderStore((s) => s.document);
  const rootId = document.rootNodeIds[0];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-y-auto p-1.5">
        {rootId && <LayerItem nodeId={rootId} depth={0} />}
      </div>
    </div>
  );
}
