"use client";

import {
  LayoutTemplate,
  Square,
  Heading,
  Type,
  MousePointerClick,
  Image as ImageIcon,
  CreditCard,
  TextCursorInput,
  FormInput,
  Columns3,
  MoveVertical,
  Layers,
  Component,
} from "lucide-react";
import { PALETTE_ITEMS, type NodeType } from "./types";
import { useCanvasBuilderStore } from "./store";
import { LayersPanel } from "./LayersPanel";

const ICONS: Record<string, typeof Type> = {
  LayoutTemplate,
  Square,
  Heading,
  Type,
  MousePointerClick,
  Image: ImageIcon,
  CreditCard,
  TextCursorInput,
  FormInput,
  Columns3,
  MoveVertical,
};

const tabBtn: React.CSSProperties = {
  flex: 1,
  height: 26,
  borderRadius: 6,
  border: "1px solid transparent",
  backgroundColor: "transparent",
  color: "var(--glass-text-3)",
  fontSize: 9,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  transition: "all 0.12s ease",
};

const tabActive: React.CSSProperties = {
  ...tabBtn,
  backgroundColor: "var(--glass-purple-soft)",
  borderColor: "var(--glass-border-purple)",
  color: "var(--glass-purple)",
};

export function ComponentPalette() {
  const setDragSource = useCanvasBuilderStore((s) => s.setDragSource);
  const leftPanelTab = useCanvasBuilderStore((s) => s.leftPanelTab);
  const setLeftPanelTab = useCanvasBuilderStore((s) => s.setLeftPanelTab);

  const handleDragStart = (type: NodeType, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-canvas-node-type", type);
    setDragSource({ type, fromPalette: true });
  };

  return (
    <div
      className="flex h-full w-full flex-col glass-panel"
      style={{ borderRight: "1px solid var(--glass-border)", borderRadius: 0 }}
    >
      {/* Tab switcher */}
      <div className="flex shrink-0 items-center gap-0.5 p-1.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <button
          onClick={() => setLeftPanelTab("components")}
          style={leftPanelTab === "components" ? tabActive : tabBtn}
        >
          <Component size={11} /> Components
        </button>
        <button
          onClick={() => setLeftPanelTab("layers")}
          style={leftPanelTab === "layers" ? tabActive : tabBtn}
        >
          <Layers size={11} /> Layers
        </button>
      </div>

      {leftPanelTab === "components" ? (
        <div className="flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-2 gap-1.5">
            {PALETTE_ITEMS.map((item) => {
              const Icon = ICONS[item.icon] ?? Type;
              return (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => handleDragStart(item.type, e)}
                  onDragEnd={() => setDragSource(null)}
                  className="flex cursor-grab flex-col items-center gap-1.5 rounded-lg border px-2 py-3 transition hover:-translate-y-0.5 active:cursor-grabbing"
                  style={{
                    borderColor: "var(--glass-border)",
                    backgroundColor: "rgba(255,255,255,0.03)",
                  }}
                  title={`Drag ${item.label} onto canvas`}
                >
                  <Icon size={16} style={{ color: "var(--glass-purple)" }} />
                  <span className="text-[10px] font-bold" style={{ color: "var(--glass-text-2)" }}>
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <LayersPanel />
      )}
    </div>
  );
}
