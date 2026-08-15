"use client";

import { memo, useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon,
  MoveVertical,
  Star,
  CircleUser,
  Video,
  Minus,
  ChevronDown,
  CheckSquare,
  Square,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";

// Dynamic icon resolver for icon/badge nodes
const LUCIDE_ICONS: Record<string, LucideIcon> = {
  Star,
  CircleUser,
  Video,
  Minus,
  ChevronDown,
  CheckSquare,
  Square,
  Link: LinkIcon,
};
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
  if (styles.flex) css.flex = styles.flex;
  if (styles.maxWidth) css.maxWidth = styles.maxWidth;
  if (styles.overflow) css.overflow = styles.overflow;
  if (styles.borderBottom) css.borderBottom = styles.borderBottom;
  return css;
}

interface NodeRendererProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onInlineEdit?: (nodeId: string, text: string) => void;
  children?: React.ReactNode;
}

function NodeRendererBase({ node, isSelected, onSelect, onDragStart, onDragEnd, onInlineEdit, children }: NodeRendererProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(node?.props?.text ?? "");
  const editRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(editRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]);

  // Guard against malformed/undefined node from corrupted persisted state
  if (!node || !node.type) return null;

  const css = stylesToCSS(node.styles ?? {});

  const canEdit = (node.type === "heading" || node.type === "text" || node.type === "button") && onInlineEdit;

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
    if (isEditing) { e.preventDefault(); return; }
    e.stopPropagation();
    onDragStart(node.id, e);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    setEditText(node.props?.text ?? "");
    setIsEditing(true);
  };

  const finishEditing = () => {
    setIsEditing(false);
    if (onInlineEdit && editText !== (node.props?.text ?? "")) {
      onInlineEdit(node.id, editText);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishEditing();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  const selectionHandles = isSelected && !isEditing ? (
    <>
      {[
        { top: -4, left: -4, cursor: "nwse-resize" },
        { top: -4, right: -4, cursor: "nesw-resize" },
        { bottom: -4, left: -4, cursor: "nesw-resize" },
        { bottom: -4, right: -4, cursor: "nwse-resize" },
      ].map((pos, i) => (
        <div key={i} style={{ position: "absolute", width: 8, height: 8, borderRadius: 2, backgroundColor: "#9b4dff", border: "1.5px solid #fff", ...pos, cursor: pos.cursor }} />
      ))}
      <div style={{ position: "absolute", top: -20, left: -2, fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", backgroundColor: "#9b4dff", padding: "1px 6px", borderRadius: 3, pointerEvents: "none", whiteSpace: "nowrap" }}>
        {node.type}
      </div>
    </>
  ) : null;

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
          {(node.children?.length ?? 0) === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 11, opacity: 0.5 }}>
              Drop components here
            </div>
          )}
          {selectionHandles}
        </div>
      );

    case "heading": {
      const level = node.props?.level ?? 2;
      const Tag = `h${level}` as "h2";
      return (
        <Tag
          ref={editRef as React.RefObject<HTMLHeadingElement>}
          style={baseStyle}
          onClick={handleSelect}
          onDoubleClick={handleDoubleClick}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
          contentEditable={isEditing}
          suppressContentEditableWarning
          onBlur={finishEditing}
          onKeyDown={handleKeyDown}
        >
          {isEditing ? editText : (node.props?.text || "Heading")}
          {selectionHandles}
        </Tag>
      );
    }

    case "text":
      return (
        <p
          ref={editRef as React.RefObject<HTMLParagraphElement>}
          style={baseStyle}
          onClick={handleSelect}
          onDoubleClick={handleDoubleClick}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
          contentEditable={isEditing}
          suppressContentEditableWarning
          onBlur={finishEditing}
          onKeyDown={handleKeyDown}
        >
          {isEditing ? editText : (node.props?.text || "Text content")}
          {selectionHandles}
        </p>
      );

    case "button":
      return (
        <button
          type="button"
          style={{ ...baseStyle, border: "none", cursor: isEditing ? "text" : "pointer" }}
          onClick={handleSelect}
          onDoubleClick={handleDoubleClick}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {isEditing ? (
            <input
              ref={editRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={finishEditing}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              style={{ background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit", textAlign: "inherit", width: "100%" }}
              autoFocus
            />
          ) : (
            node.props?.text || "Button"
          )}
          {selectionHandles}
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
          {node.props?.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.props.src} alt={node.props.alt ?? ""} style={{ width: "100%", height: "auto", borderRadius: node.styles?.borderRadius ?? 8, display: "block" }} />
          ) : (
            <div style={{ width: "100%", minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8, color: "var(--text-muted)", fontSize: 11 }}>
              <ImageIcon size={24} opacity={0.4} />
            </div>
          )}
          {selectionHandles}
        </div>
      );

    case "input":
      return (
        <div style={baseStyle} onClick={handleSelect} data-node-id={node.id} data-node-type={node.type}>
          <input
            type={node.props?.inputType ?? "text"}
            placeholder={node.props?.placeholder ?? ""}
            name={node.props?.inputName ?? ""}
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
          {selectionHandles}
        </div>
      );

    case "icon": {
      const IconComp = LUCIDE_ICONS[node.props?.iconName ?? "Star"] ?? Star;
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          <IconComp size={node.styles?.fontSize ?? 24} />
          {selectionHandles}
        </div>
      );
    }

    case "badge":
      return (
        <span style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          {node.props?.text || "Badge"}
          {selectionHandles}
        </span>
      );

    case "avatar":
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          {node.props?.avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.props.avatarSrc} alt={node.props.avatarName ?? "Avatar"} style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", borderRadius: "inherit", backgroundColor: "rgba(139,92,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CircleUser size={20} style={{ color: "var(--glass-purple)" }} />
            </div>
          )}
          {selectionHandles}
        </div>
      );

    case "video":
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          {node.props?.videoSrc ? (
            <video src={node.props.videoSrc} poster={node.props.videoPoster} controls style={{ width: "100%", borderRadius: "inherit" }} />
          ) : (
            <div style={{ width: "100%", minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: "inherit", color: "var(--text-muted)" }}>
              <Video size={28} opacity={0.4} />
            </div>
          )}
          {selectionHandles}
        </div>
      );

    case "divider":
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          <hr style={{ border: "none", height: "1px", backgroundColor: node.styles?.backgroundColor ?? "var(--glass-border)", margin: 0 }} />
          {selectionHandles}
        </div>
      );

    case "tabs": {
      const labels = node.props?.tabLabels ?? ["Tab 1", "Tab 2"];
      const active = node.props?.activeTab ?? 0;
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          <div style={{ display: "flex", flexDirection: "row", gap: 4, borderBottom: "1px solid var(--glass-border)" }}>
            {labels.map((label, i) => (
              <div key={i} style={{ padding: "8px 16px", fontSize: 13, fontWeight: i === active ? 700 : 500, color: i === active ? "var(--glass-purple)" : "var(--text-muted)", borderBottom: i === active ? "2px solid var(--glass-purple)" : "2px solid transparent", cursor: "pointer" }}>
                {label}
              </div>
            ))}
          </div>
          <div style={{ padding: "16px", fontSize: 14, color: "var(--text-secondary)" }}>
            {labels[active]} content
          </div>
          {selectionHandles}
        </div>
      );
    }

    case "accordion": {
      const items = node.props?.accordionItems ?? [];
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          {items.map((item, i) => (
            <div key={i} style={{ borderRadius: 8, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "var(--glass-border)", borderStyle: "solid", overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                {item.title}
                <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />
              </div>
              <div style={{ padding: "0 16px 14px", fontSize: 13, color: "var(--text-secondary)" }}>
                {item.content}
              </div>
            </div>
          ))}
          {selectionHandles}
        </div>
      );
    }

    case "navbar":
    case "footer":
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
          {(node.children?.length ?? 0) === 0 && (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 11, opacity: 0.5 }}>
              Drop content here
            </div>
          )}
          {selectionHandles}
        </div>
      );

    case "table": {
      const headers = node.props?.tableHeaders ?? [];
      const rows = node.props?.tableRows ?? [];
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--glass-border)" }}>
                {headers.map((hdr, i) => (
                  <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{hdr}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "10px 14px", color: "var(--text-primary)" }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {selectionHandles}
        </div>
      );
    }

    case "list": {
      const items = node.props?.listItems ?? [];
      return (
        <div style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          <ul style={{ listStyle: "disc", paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((item, i) => (
              <li key={i} style={{ color: "var(--text-secondary)" }}>{item}</li>
            ))}
          </ul>
          {selectionHandles}
        </div>
      );
    }

    case "textarea":
      return (
        <div style={baseStyle} onClick={handleSelect} data-node-id={node.id} data-node-type={node.type}>
          <textarea
            placeholder={node.props?.placeholder ?? ""}
            name={node.props?.inputName ?? ""}
            rows={node.props?.rows ?? 4}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--studio-border-strong)", fontSize: 14, color: "var(--text-primary)", outline: "none", resize: "vertical", fontFamily: "inherit" }}
            onClick={(e) => e.stopPropagation()}
            readOnly
          />
          {selectionHandles}
        </div>
      );

    case "checkbox":
      return (
        <label style={baseStyle} onClick={handleSelect} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd} data-node-id={node.id} data-node-type={node.type}>
          {node.props?.checked ? <CheckSquare size={16} style={{ color: "var(--glass-purple)" }} /> : <Square size={16} style={{ color: "var(--text-muted)" }} />}
          <span style={{ color: "var(--text-secondary)" }}>{node.props?.label ?? "Checkbox"}</span>
          {selectionHandles}
        </label>
      );

    case "link":
      return (
        <a
          href={node.props?.href ?? "#"}
          style={baseStyle}
          onClick={(e) => { e.preventDefault(); handleSelect(e); }}
          draggable
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          data-node-id={node.id}
          data-node-type={node.type}
        >
          {node.props?.text || "Link"}
          {selectionHandles}
        </a>
      );

    default:
      return (
        <div style={baseStyle} onClick={handleSelect} data-node-id={node.id}>
          {node.type}
          {selectionHandles}
        </div>
      );
  }
}

export const NodeRenderer = memo(NodeRendererBase);
