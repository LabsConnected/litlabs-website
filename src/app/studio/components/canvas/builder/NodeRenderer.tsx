"use client";

import { memo } from "react";
import {
  Type,
  Heading,
  MousePointerClick,
  Image as ImageIcon,
  CreditCard,
  TextCursorInput,
  FormInput,
  Columns3,
  MoveVertical,
  Square,
  LayoutTemplate,
} from "lucide-react";
import type { CanvasNode, NodeStyles } from "./types";

function stylesToCSS(styles: NodeStyles): React.CSSProperties {
  const css: React.CSSProperties = {};
  if (styles.width) css.width = styles.width;
  if (styles.height) css.height = styles.height;
  if (styles.padding) {
    css.padding = styles.padding;
  } else if (styles.paddingTop != null || styles.paddingRight != null || styles.paddingBottom != null || styles.paddingLeft != null) {
    css.paddingTop = styles.paddingTop;
    css.paddingRight = styles.paddingRight;
    css.paddingBottom = styles.paddingBottom;
    css.paddingLeft = styles.paddingLeft;
  }
  if (styles.margin) {
    css.margin = styles.margin;
  } else if (styles.marginTop != null) {
    css.marginTop = styles.marginTop;
    css.marginRight = styles.marginRight;
    css.marginBottom = styles.marginBottom;
    css.marginLeft = styles.marginLeft;
  }
  if (styles.borderRadius != null) css.borderRadius = styles.borderRadius;
  if (styles.backgroundColor) css.backgroundColor = styles.backgroundColor;
  if (styles.color) css.color = styles.color;
  if (styles.fontSize != null) css.fontSize = styles.fontSize;
  if (styles.fontWeight) css.fontWeight = styles.fontWeight;
  if (styles.fontFamily) css.fontFamily = styles.fontFamily;
  if (styles.textAlign) css.textAlign = styles.textAlign;
  if (styles.gap != null) css.gap = styles.gap;
  if (styles.display) css.display = styles.display;
  if (styles.flexDirection) css.flexDirection = styles.flexDirection;
  if (styles.alignItems) css.alignItems = styles.alignItems;
  if (styles.justifyContent) css.justifyContent = styles.justifyContent;
  if (styles.borderWidth != null) {
    css.borderWidth = styles.borderWidth;
    css.borderStyle = styles.borderStyle ?? "solid";
    css.borderColor = styles.borderColor ?? "var(--studio-border-strong)";
  }
  if (styles.boxShadow) css.boxShadow = styles.boxShadow;
  if (styles.opacity != null) css.opacity = styles.opacity;
  if (styles.visible === false) css.display = "none";
  if (styles.minHeight) css.minHeight = styles.minHeight;
  if (styles.minWidth) css.minWidth = styles.minWidth;
  return css;
}

interface NodeRendererProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  children?: React.ReactNode;
}

function NodeRendererBase({ node, isSelected, onSelect, onDragStart, onDragEnd, children }: NodeRendererProps) {
  const css = stylesToCSS(node.styles);
  const baseStyle: React.CSSProperties = {
    ...css,
    position: "relative",
    cursor: "pointer",
    outline: isSelected ? "2px solid #9b4dff" : "none",
    outlineOffset: isSelected ? "2px" : "0",
    transition: "outline 0.1s ease",
    minHeight: node.type === "spacer" ? undefined : "min-content",
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id, e);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    onDragStart(node.id, e);
  };

  // Render based on type
  switch (node.type) {
    case "section":
    case "container":
    case "card":
    case "form":
    case "columns":
      return (
        <div
          style={baseStyle}
          onClick={handleSelect}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {children}
          {node.children.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 11, opacity: 0.5 }}>
              Drop components here
            </div>
          )}
        </div>
      );

    case "heading": {
      const level = node.props.level ?? 2;
      const Tag = (`h${level}` as keyof React.JSX.IntrinsicElements);
      return (
        <Tag
          style={baseStyle}
          onClick={handleSelect}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {node.props.text || "Heading"}
        </Tag>
      );
    }

    case "text":
      return (
        <p
          style={baseStyle}
          onClick={handleSelect}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {node.props.text || "Text content"}
        </p>
      );

    case "button":
      return (
        <button
          type="button"
          style={{ ...baseStyle, border: "none", cursor: "pointer" }}
          onClick={handleSelect}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {node.props.text || "Button"}
        </button>
      );

    case "image":
      return (
        <div
          style={baseStyle}
          onClick={handleSelect}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {node.props.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.props.src} alt={node.props.alt ?? ""} style={{ width: "100%", height: "auto", borderRadius: node.styles.borderRadius ?? 8, display: "block" }} />
          ) : (
            <div style={{ width: "100%", minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8, color: "var(--text-muted)", fontSize: 11 }}>
              <ImageIcon size={24} opacity={0.4} />
            </div>
          )}
        </div>
      );

    case "input":
      return (
        <div style={baseStyle} onClick={handleSelect} data-node-id={node.id} data-node-type={node.type}>
          <input
            type={node.props.inputType ?? "text"}
            placeholder={node.props.placeholder ?? ""}
            name={node.props.inputName ?? ""}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--studio-border-strong)", fontSize: 14, color: "var(--text-primary)", outline: "none" }}
            onClick={(e) => e.stopPropagation()}
            readOnly
          />
        </div>
      );

    case "spacer":
      return (
        <div
          style={{ ...baseStyle, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={handleSelect}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          <MoveVertical size={14} opacity={0.2} />
        </div>
      );

    default:
      return (
        <div style={baseStyle} onClick={handleSelect} data-node-id={node.id}>
          {node.type}
        </div>
      );
  }
}

export const NodeRenderer = memo(NodeRendererBase);
