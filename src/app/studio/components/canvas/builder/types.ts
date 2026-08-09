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
  maxWidth?: string;
  flex?: string;
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
    name?: string;
    locked?: boolean;
    hidden?: boolean;
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

export type Breakpoint = "desktop" | "tablet" | "mobile";

export const BREAKPOINT_WIDTHS: Record<Breakpoint, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

export interface SectionTemplate {
  id: string;
  label: string;
  icon: string;
  build: () => { node: CanvasNode; children: CanvasNode[] };
}

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: "hero",
    label: "Hero",
    icon: "Sparkles",
    build: () => {
      const now = Date.now();
      const section = createNode("section");
      section.styles = { ...section.styles, padding: "80px 48px", display: "flex", flexDirection: "column", gap: 24, alignItems: "center", justifyContent: "center", minHeight: "400px", backgroundColor: "rgba(139,92,246,0.05)" };
      const heading = createNode("heading");
      heading.props = { text: "Build Something Amazing", level: 1 };
      heading.styles = { fontSize: 48, fontWeight: "800", textAlign: "center", color: "var(--text-primary)" };
      const text = createNode("text");
      text.props = { text: "Your vision, powered by LiTTree. Start building your dream project today." };
      text.styles = { fontSize: 16, textAlign: "center", color: "var(--text-secondary)", maxWidth: "500px" };
      const btn = createNode("button");
      btn.props = { text: "Get Started", href: "#" };
      btn.styles = { padding: "12px 32px", borderRadius: 10, backgroundColor: "#9b4dff", color: "#fff", fontSize: 16, fontWeight: "700" };
      section.children = [heading.id, text.id, btn.id];
      heading.parentId = section.id;
      text.parentId = section.id;
      btn.parentId = section.id;
      return { node: section, children: [heading, text, btn] };
    },
  },
  {
    id: "features",
    label: "Features",
    icon: "Grid3x3",
    build: () => {
      const now = Date.now();
      const section = createNode("section");
      section.styles = { ...section.styles, padding: "64px 48px", display: "flex", flexDirection: "column", gap: 32 };
      const heading = createNode("heading");
      heading.props = { text: "Features", level: 2 };
      heading.styles = { fontSize: 32, fontWeight: "700", textAlign: "center", color: "var(--text-primary)" };
      const columns = createNode("columns");
      columns.props = { columns: 3 };
      columns.styles = { display: "flex", flexDirection: "row", gap: 24 };
      const cards: CanvasNode[] = [];
      for (let i = 0; i < 3; i++) {
        const card = createNode("card");
        card.styles = { padding: "24px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 12, borderWidth: 1, borderColor: "var(--studio-border-strong)", borderStyle: "solid", flex: "1" };
        const cardHeading = createNode("heading");
        cardHeading.props = { text: ["Fast", "Secure", "Scalable"][i], level: 3 };
        cardHeading.styles = { fontSize: 18, fontWeight: "700", color: "var(--text-primary)" };
        const cardText = createNode("text");
        cardText.props = { text: ["Lightning quick performance", "Enterprise-grade security", "Grows with your needs"][i] };
        cardText.styles = { fontSize: 13, color: "var(--text-secondary)" };
        card.children = [cardHeading.id, cardText.id];
        cardHeading.parentId = card.id;
        cardText.parentId = card.id;
        cards.push(card, cardHeading, cardText);
      }
      const cardNodes = cards.filter((c) => c.type === "card");
      columns.children = cardNodes.map((c) => c.id);
      cardNodes.forEach((c) => { c.parentId = columns.id; });
      section.children = [heading.id, columns.id];
      heading.parentId = section.id;
      columns.parentId = section.id;
      return { node: section, children: [heading, columns, ...cards] };
    },
  },
  {
    id: "cta",
    label: "CTA",
    icon: "Megaphone",
    build: () => {
      const section = createNode("section");
      section.styles = { ...section.styles, padding: "64px 48px", display: "flex", flexDirection: "column", gap: 24, alignItems: "center", backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 16 };
      const heading = createNode("heading");
      heading.props = { text: "Ready to Start?", level: 2 };
      heading.styles = { fontSize: 32, fontWeight: "700", textAlign: "center", color: "var(--text-primary)" };
      const btn = createNode("button");
      btn.props = { text: "Launch Project", href: "#" };
      btn.styles = { padding: "14px 36px", borderRadius: 10, backgroundColor: "#9b4dff", color: "#fff", fontSize: 16, fontWeight: "700" };
      section.children = [heading.id, btn.id];
      heading.parentId = section.id;
      btn.parentId = section.id;
      return { node: section, children: [heading, btn] };
    },
  },
  {
    id: "pricing",
    label: "Pricing",
    icon: "Tag",
    build: () => {
      const section = createNode("section");
      section.styles = { ...section.styles, padding: "64px 48px", display: "flex", flexDirection: "column", gap: 32 };
      const heading = createNode("heading");
      heading.props = { text: "Pricing", level: 2 };
      heading.styles = { fontSize: 32, fontWeight: "700", textAlign: "center", color: "var(--text-primary)" };
      const columns = createNode("columns");
      columns.props = { columns: 3 };
      columns.styles = { display: "flex", flexDirection: "row", gap: 24 };
      const allChildren: CanvasNode[] = [heading, columns];
      const plans = [
        { name: "Starter", price: "$0", desc: "Perfect for trying out" },
        { name: "Pro", price: "$29", desc: "For growing projects" },
        { name: "Enterprise", price: "$99", desc: "Unlimited everything" },
      ];
      const cardNodes: CanvasNode[] = [];
      for (const plan of plans) {
        const card = createNode("card");
        card.styles = { padding: "28px", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 12, borderWidth: 1, borderColor: "var(--studio-border-strong)", borderStyle: "solid", flex: "1" };
        const h = createNode("heading");
        h.props = { text: plan.name, level: 3 };
        h.styles = { fontSize: 20, fontWeight: "700", color: "var(--text-primary)" };
        const price = createNode("heading");
        price.props = { text: plan.price, level: 3 };
        price.styles = { fontSize: 36, fontWeight: "800", color: "#9b4dff" };
        const desc = createNode("text");
        desc.props = { text: plan.desc };
        desc.styles = { fontSize: 13, color: "var(--text-secondary)" };
        const btn = createNode("button");
        btn.props = { text: "Choose", href: "#" };
        btn.styles = { padding: "10px 20px", borderRadius: 8, backgroundColor: "#9b4dff", color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center" };
        card.children = [h.id, price.id, desc.id, btn.id];
        h.parentId = card.id; price.parentId = card.id; desc.parentId = card.id; btn.parentId = card.id;
        cardNodes.push(card);
        allChildren.push(h, price, desc, btn);
      }
      columns.children = cardNodes.map((c) => c.id);
      cardNodes.forEach((c) => { c.parentId = columns.id; });
      section.children = [heading.id, columns.id];
      heading.parentId = section.id;
      columns.parentId = section.id;
      return { node: section, children: allChildren };
    },
  },
];
