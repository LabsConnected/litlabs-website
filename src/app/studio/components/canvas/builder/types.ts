/**
 * Visual Canvas Builder — structured document types.
 *
 * The CanvasDocument is the source of truth for visual editing.
 * LiTT reads the document + selected node to understand context.
 * Code generation/sync happens separately, not on every drag.
 */

export type NodeType =
  | "section"
  | "container"
  | "text"
  | "heading"
  | "button"
  | "image"
  | "card"
  | "input"
  | "form"
  | "columns"
  | "spacer";

export interface NodeStyles {
  width?: string;
  height?: string;
  padding?: string;
  margin?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  borderRadius?: number;
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: "left" | "center" | "right";
  gap?: number;
  display?: string;
  flexDirection?: "row" | "column";
  alignItems?: string;
  justifyContent?: string;
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: string;
  boxShadow?: string;
  opacity?: number;
  visible?: boolean;
  minHeight?: string;
  minWidth?: string;
}

export interface NodeProps {
  text?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  href?: string;
  src?: string;
  alt?: string;
  placeholder?: string;
  inputType?: string;
  inputName?: string;
  columns?: number;
  assetId?: string;
}

export interface CanvasNode {
  id: string;
  type: NodeType;
  parentId: string | null;
  children: string[];
  props: NodeProps;
  styles: NodeStyles;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

export interface CanvasDocument {
  id: string;
  projectId: string | null;
  conversationId: string | null;
  route: string;
  nodes: Record<string, CanvasNode>;
  rootNodeIds: string[];
  version: number;
  updatedAt: number;
}

export interface CanvasHistoryEntry {
  document: CanvasDocument;
  description: string;
  timestamp: number;
}

// Component palette definitions
export interface PaletteItem {
  type: NodeType;
  label: string;
  icon: string;
  defaultProps: NodeProps;
  defaultStyles: NodeStyles;
  canHaveChildren: boolean;
}

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "section",
    label: "Section",
    icon: "LayoutTemplate",
    canHaveChildren: true,
    defaultProps: {},
    defaultStyles: { padding: "48px", display: "flex", flexDirection: "column", gap: 16, borderRadius: 0 },
  },
  {
    type: "container",
    label: "Container",
    icon: "Square",
    canHaveChildren: true,
    defaultProps: {},
    defaultStyles: { padding: "24px", display: "flex", flexDirection: "column", gap: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.03)" },
  },
  {
    type: "heading",
    label: "Heading",
    icon: "Heading",
    canHaveChildren: false,
    defaultProps: { text: "Heading", level: 2 },
    defaultStyles: { fontSize: 28, fontWeight: "700", textAlign: "left", color: "var(--text-primary)" },
  },
  {
    type: "text",
    label: "Text",
    icon: "Type",
    canHaveChildren: false,
    defaultProps: { text: "Text content" },
    defaultStyles: { fontSize: 14, textAlign: "left", color: "var(--text-secondary)" },
  },
  {
    type: "button",
    label: "Button",
    icon: "MousePointerClick",
    canHaveChildren: false,
    defaultProps: { text: "Click me", href: "" },
    defaultStyles: {
      padding: "10px 20px",
      borderRadius: 8,
      backgroundColor: "#9b4dff",
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
      textAlign: "center",
    },
  },
  {
    type: "image",
    label: "Image",
    icon: "Image",
    canHaveChildren: false,
    defaultProps: { src: "", alt: "Image" },
    defaultStyles: { borderRadius: 8, width: "100%", height: "auto" },
  },
  {
    type: "card",
    label: "Card",
    icon: "CreditCard",
    canHaveChildren: true,
    defaultProps: {},
    defaultStyles: {
      padding: "20px",
      borderRadius: 16,
      backgroundColor: "rgba(255,255,255,0.05)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      borderWidth: 1,
      borderColor: "var(--studio-border-strong)",
      borderStyle: "solid",
    },
  },
  {
    type: "input",
    label: "Input",
    icon: "TextCursorInput",
    canHaveChildren: false,
    defaultProps: { placeholder: "Enter text...", inputType: "text", inputName: "" },
    defaultStyles: {
      padding: "10px 14px",
      borderRadius: 8,
      backgroundColor: "rgba(255,255,255,0.03)",
      borderWidth: 1,
      borderColor: "var(--studio-border-strong)",
      borderStyle: "solid",
      fontSize: 14,
      color: "var(--text-primary)",
    },
  },
  {
    type: "form",
    label: "Form",
    icon: "FormInput",
    canHaveChildren: true,
    defaultProps: {},
    defaultStyles: { padding: "24px", display: "flex", flexDirection: "column", gap: 12, borderRadius: 12 },
  },
  {
    type: "columns",
    label: "Columns",
    icon: "Columns3",
    canHaveChildren: true,
    defaultProps: { columns: 2 },
    defaultStyles: { display: "flex", flexDirection: "row", gap: 16 },
  },
  {
    type: "spacer",
    label: "Spacer",
    icon: "MoveVertical",
    canHaveChildren: false,
    defaultProps: {},
    defaultStyles: { height: "32px" },
  },
];

export function createNode(type: NodeType, projectId?: string): CanvasNode {
  const palette = PALETTE_ITEMS.find((p) => p.type === type);
  if (!palette) throw new Error(`Unknown node type: ${type}`);
  const now = Date.now();
  return {
    id: `node-${now}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    parentId: null,
    children: [],
    props: { ...palette.defaultProps },
    styles: { ...palette.defaultStyles },
    metadata: { createdAt: now, updatedAt: now },
  };
}

export function createEmptyDocument(projectId?: string | null, conversationId?: string | null): CanvasDocument {
  const now = Date.now();
  const rootId = `root-${now}-${Math.random().toString(36).slice(2, 9)}`;
  const root: CanvasNode = {
    id: rootId,
    type: "section",
    parentId: null,
    children: [],
    props: {},
    styles: { display: "flex", flexDirection: "column", gap: 0, padding: "0", minHeight: "100%" },
    metadata: { createdAt: now, updatedAt: now },
  };
  return {
    id: `doc-${now}-${Math.random().toString(36).slice(2, 9)}`,
    projectId: projectId ?? null,
    conversationId: conversationId ?? null,
    route: "/",
    nodes: { [rootId]: root },
    rootNodeIds: [rootId],
    version: 1,
    updatedAt: now,
  };
}
