"use client";

/**
 * MobileToolsSheet — bottom-sheet content for the LiTT Studio mobile redesign.
 *
 * Consolidates the Code, Canvas, Preview, Files, Terminal, and Activity entry
 * points ("Build") into a single sheet on mobile, plus first-class media
 * tools (Image, Video, Audio, Music) as a Home-like 2x2 tile grid ("Create").
 * Pure presentational content: the parent wires each entry to the existing
 * CommandStudio handlers.
 *
 * Visual language follows MissionCards' QuickAction chip styling (cyan icon on
 * a faint cyan wash, hairline border), enlarged to a full-width 56px touch row.
 */

import type { ComponentType, CSSProperties } from "react";
import { Activity, Film, FolderOpen, Hammer, Image as ImageIcon, Layout, Mic, Music, Play, Terminal } from "lucide-react";

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
  onOpenImage: () => void;
  onOpenVideo: () => void;
  onOpenAudio: () => void;
  onOpenMusic: () => void;
}

type IconType = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string; style?: CSSProperties }>;

type CreateTile = {
  id: string;
  label: string;
  description: string;
  icon: IconType;
  onOpen: (props: MobileToolsSheetProps) => () => void;
};

const CREATE_TILES: CreateTile[] = [
  {
    id: "image",
    label: "Image",
    description: "Generate images",
    icon: ImageIcon,
    onOpen: (p) => p.onOpenImage,
  },
  {
    id: "video",
    label: "Video",
    description: "Generate video",
    icon: Film,
    onOpen: (p) => p.onOpenVideo,
  },
  {
    id: "audio",
    label: "Audio",
    description: "Voiceover & speech",
    icon: Mic,
    onOpen: (p) => p.onOpenAudio,
  },
  {
    id: "music",
    label: "Music",
    description: "Generate music",
    icon: Music,
    onOpen: (p) => p.onOpenMusic,
  },
];

type ToolRow = {
  id: string;
  label: string;
  description: string;
  icon: IconType;
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

function SectionHeader({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        padding: "6px 4px 0",
      }}
    >
      {children}
    </div>
  );
}

function CreateTileButton({
  id,
  label,
  description,
  icon: Icon,
  onClick,
}: {
  id: string;
  label: string;
  description: string;
  icon: IconType;
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
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        minHeight: 84,
        padding: "12px 14px",
        borderRadius: 12,
        border: `1px solid ${CARD_BORDER}`,
        backgroundColor: TOOLS_BG,
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text-main)",
      }}
    >
      <Icon size={22} strokeWidth={2} className="pointer-events-none shrink-0" style={{ color: CYAN }} />
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
      <SectionHeader>Create</SectionHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {CREATE_TILES.map((tile) => (
          <CreateTileButton
            key={tile.id}
            id={tile.id}
            label={tile.label}
            description={tile.description}
            icon={tile.icon}
            onClick={tile.onOpen(props)}
          />
        ))}
      </div>
      <SectionHeader>Build</SectionHeader>
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
