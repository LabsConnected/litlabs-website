"use client";

/**
 * MobileToolsSheet — bottom-sheet content for the LiTT Studio mobile redesign.
 *
 * Consolidates the Code, Canvas, Preview, Files, Terminal, and Activity entry
 * points into a single sheet on mobile. Pure presentational content: the parent
 * wires each row to the existing CommandStudio handlers.
 *
 * Visual language follows MissionCards' QuickAction chip styling (cyan icon on
 * a faint cyan wash, hairline border), enlarged to a full-width 56px touch row.
 */

import type { ComponentType, CSSProperties } from "react";
import { Activity, FolderOpen, Hammer, Layout, Play, Terminal } from "lucide-react";

const CYAN = "#22d3ee";
const CARD_BORDER = "rgba(255,255,255,0.07)";
const TOOLS_BG = "rgba(34,211,238,0.07)";

export interface MobileToolsSheetProps {
  onOpenCode: () => void;
  onOpenCanvas: () => void;
  onOpenPreview: () => void;
  onOpenFiles: () => void;
  onOpenTerminal: () => void;
  onOpenActivity: () => void;
}

type ToolRow = {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string; style?: CSSProperties }>;
  onOpen: (props: MobileToolsSheetProps) => () => void;
};

const TOOL_ROWS: ToolRow[] = [
  {
    id: "code",
    label: "Open Code",
    description: "Browse and edit workspace files",
    icon: Hammer,
    onOpen: (p) => p.onOpenCode,
  },
  {
    id: "canvas",
    label: "Open Canvas",
    description: "Visual canvas builder",
    icon: Layout,
    onOpen: (p) => p.onOpenCanvas,
  },
  {
    id: "preview",
    label: "Open Preview",
    description: "Live preview of your project",
    icon: Play,
    onOpen: (p) => p.onOpenPreview,
  },
  {
    id: "files",
    label: "Open Files",
    description: "Project file browser",
    icon: FolderOpen,
    onOpen: (p) => p.onOpenFiles,
  },
  {
    id: "terminal",
    label: "Open Terminal",
    description: "Run commands in the workspace",
    icon: Terminal,
    onOpen: (p) => p.onOpenTerminal,
  },
  {
    id: "activity",
    label: "View Activity",
    description: "Agent activity and tool calls",
    icon: Activity,
    onOpen: (p) => p.onOpenActivity,
  },
];

function ToolRowButton({
  id,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  id: string;
  label: string;
  description: string;
  icon: ToolRow["icon"];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={`mobile-tool-${id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 56,
        padding: "10px 14px",
        borderRadius: 12,
        border: `1px solid ${CARD_BORDER}`,
        backgroundColor: TOOLS_BG,
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text-main)",
      }}
    >
      <Icon size={18} strokeWidth={2} className="pointer-events-none shrink-0" style={{ color: CYAN }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{description}</span>
      </span>
    </button>
  );
}

export default function MobileToolsSheet(props: MobileToolsSheetProps) {
  return (
    <div data-testid="mobile-tools-sheet" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {TOOL_ROWS.map((row) => (
        <ToolRowButton
          key={row.id}
          id={row.id}
          label={row.label}
          description={row.description}
          icon={row.icon}
          onClick={row.onOpen(props)}
        />
      ))}
    </div>
  );
}
