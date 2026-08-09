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
} from "lucide-react";
import { PALETTE_ITEMS, type NodeType } from "./types";
import { useCanvasBuilderStore } from "./store";

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

export function ComponentPalette() {
  const setDragSource = useCanvasBuilderStore((s) => s.setDragSource);

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
      <div
        className="shrink-0 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--studio-border)" }}
      >
        Components
      </div>
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
                  borderColor: "var(--studio-border-strong)",
                  backgroundColor: "var(--studio-card)",
                }}
                title={`Drag ${item.label} onto canvas`}
              >
                <Icon size={16} style={{ color: "var(--litt-primary)" }} />
                <span className="text-[10px] font-bold" style={{ color: "var(--text-secondary)" }}>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
