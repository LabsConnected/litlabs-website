"use client";

/**
 * LeftPanel — the main left sidebar with 5 tabs:
 *   Build | Blocks | Components | Assets | Layers
 *
 * - Build: full-page starter templates (landing page, dashboard, etc.)
 * - Blocks: pre-built section blocks (hero, features, pricing, etc.)
 * - Components: individual primitives (heading, button, image, etc.)
 * - Assets: user's media library
 * - Layers: document tree / layer list
 */

import {
  Hammer,
  Blocks,
  Component,
  FolderOpen,
  Layers,
  Type,
  Square,
  Heading,
  MousePointerClick,
  Image as ImageIcon,
  CreditCard,
  TextCursorInput,
  FormInput,
  Columns3,
  MoveVertical,
  Star,
  Tag,
  CircleUser,
  Video,
  Minus,
  PanelTop,
  ChevronDown,
  Menu,
  PanelBottom,
  Table,
  List,
  AlignLeft,
  CheckSquare,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";
import { PALETTE_ITEMS, type NodeType } from "./types";
import { useCanvasBuilderStore } from "./store";
import { LayersPanel } from "./LayersPanel";
import { BuildPanel } from "./BuildPanel";
import { BlocksPanel } from "./BlocksPanel";
import { AssetsPanel } from "./AssetsPanel";

const ICONS: Record<string, LucideIcon> = {
  LayoutTemplate: Square,
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
  Star,
  Tag,
  "CircleUser": CircleUser,
  Video,
  Minus,
  "PanelTop": PanelTop,
  ChevronDown,
  Menu,
  "PanelBottom": PanelBottom,
  Table,
  List,
  "AlignLeft": AlignLeft,
  "CheckSquare": CheckSquare,
  Link: LinkIcon,
};

const TAB_CONFIG: { id: "build" | "blocks" | "components" | "assets" | "layers"; label: string; icon: LucideIcon }[] = [
  { id: "build", label: "Build", icon: Hammer },
  { id: "blocks", label: "Blocks", icon: Blocks },
  { id: "components", label: "Components", icon: Component },
  { id: "assets", label: "Assets", icon: FolderOpen },
  { id: "layers", label: "Layers", icon: Layers },
];

const tabBtn: React.CSSProperties = {
  flex: 1,
  height: 26,
  borderRadius: 6,
  border: "1px solid transparent",
  backgroundColor: "transparent",
  color: "var(--glass-text-3)",
  fontSize: 8,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 3,
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
      {/* Tab switcher — 5 tabs */}
      <div className="flex shrink-0 items-center gap-0.5 p-1.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setLeftPanelTab(tab.id)}
              style={leftPanelTab === tab.id ? tabActive : tabBtn}
            >
              <Icon size={10} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {leftPanelTab === "build" && <BuildPanel />}

      {leftPanelTab === "blocks" && <BlocksPanel />}

      {leftPanelTab === "components" && (
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
      )}

      {leftPanelTab === "assets" && <AssetsPanel />}

      {leftPanelTab === "layers" && <LayersPanel />}
    </div>
  );
}
