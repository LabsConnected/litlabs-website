/**
 * Canvas → HTML serializer
 *
 * Converts a CanvasDocument into a self-contained HTML string that can
 * be rendered inside an iframe for the Preview mode. This gives a true
 * browser-like preview of the page — real links, hover states, scrolling,
 * forms, etc. — without the builder outlines/handles.
 */

import type { CanvasDocument, CanvasNode, NodeStyles } from "./types";

function stylesToCSSString(styles: NodeStyles): string {
  const parts: string[] = [];
  if (styles.width) parts.push(`width: ${styles.width}`);
  if (styles.height) parts.push(`height: ${styles.height}`);
  if (styles.padding) parts.push(`padding: ${styles.padding}`);
  else if (styles.paddingTop != null || styles.paddingRight != null || styles.paddingBottom != null || styles.paddingLeft != null) {
    parts.push(`padding: ${styles.paddingTop ?? 0}px ${styles.paddingRight ?? 0}px ${styles.paddingBottom ?? 0}px ${styles.paddingLeft ?? 0}px`);
  }
  if (styles.margin) parts.push(`margin: ${styles.margin}`);
  else if (styles.marginTop != null) {
    parts.push(`margin: ${styles.marginTop ?? 0}px ${styles.marginRight ?? 0}px ${styles.marginBottom ?? 0}px ${styles.marginLeft ?? 0}px`);
  }
  if (styles.borderRadius != null) parts.push(`border-radius: ${styles.borderRadius}px`);
  if (styles.backgroundColor) parts.push(`background-color: ${styles.backgroundColor}`);
  if (styles.color) parts.push(`color: ${styles.color}`);
  if (styles.fontSize != null) parts.push(`font-size: ${styles.fontSize}px`);
  if (styles.fontWeight) parts.push(`font-weight: ${styles.fontWeight}`);
  if (styles.fontFamily) parts.push(`font-family: ${styles.fontFamily}`);
  if (styles.textAlign) parts.push(`text-align: ${styles.textAlign}`);
  if (styles.gap != null) parts.push(`gap: ${styles.gap}px`);
  if (styles.display) parts.push(`display: ${styles.display}`);
  if (styles.flexDirection) parts.push(`flex-direction: ${styles.flexDirection}`);
  if (styles.alignItems) parts.push(`align-items: ${styles.alignItems}`);
  if (styles.justifyContent) parts.push(`justify-content: ${styles.justifyContent}`);
  if (styles.borderWidth != null) parts.push(`border: ${styles.borderWidth}px ${styles.borderStyle || "solid"} ${styles.borderColor || "transparent"}`);
  if (styles.boxShadow) parts.push(`box-shadow: ${styles.boxShadow}`);
  if (styles.opacity != null) parts.push(`opacity: ${styles.opacity}`);
  if (styles.minHeight) parts.push(`min-height: ${styles.minHeight}`);
  if (styles.minWidth) parts.push(`min-width: ${styles.minWidth}`);
  if (styles.maxWidth) parts.push(`max-width: ${styles.maxWidth}`);
  if (styles.flex) parts.push(`flex: ${styles.flex}`);
  if (styles.overflow) parts.push(`overflow: ${styles.overflow}`);
  if (styles.position) parts.push(`position: ${styles.position}`);
  if (styles.top) parts.push(`top: ${styles.top}`);
  if (styles.bottom) parts.push(`bottom: ${styles.bottom}`);
  if (styles.left) parts.push(`left: ${styles.left}`);
  if (styles.right) parts.push(`right: ${styles.right}`);
  if (styles.zIndex != null) parts.push(`z-index: ${styles.zIndex}`);
  if (styles.cursor) parts.push(`cursor: ${styles.cursor}`);
  if (styles.objectFit) parts.push(`object-fit: ${styles.objectFit}`);
  if (styles.lineHeight) parts.push(`line-height: ${styles.lineHeight}`);
  if (styles.letterSpacing) parts.push(`letter-spacing: ${styles.letterSpacing}`);
  if (styles.textTransform) parts.push(`text-transform: ${styles.textTransform}`);
  if (styles.gridTemplateColumns) parts.push(`grid-template-columns: ${styles.gridTemplateColumns}`);
  if (styles.gridGap) parts.push(`grid-gap: ${styles.gridGap}`);
  if (styles.aspectRatio) parts.push(`aspect-ratio: ${styles.aspectRatio}`);
  return parts.join("; ");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nodeToHtml(node: CanvasNode, doc: CanvasDocument, depth = 0): string {
  if (node.metadata?.hidden) return "";

  const styleStr = stylesToCSSString(node.styles);
  const styleAttr = styleStr ? ` style="${styleStr}"` : "";

  const children = node.children
    .map((childId) => doc.nodes[childId])
    .filter(Boolean)
    .map((child) => nodeToHtml(child, doc, depth + 1))
    .join("\n");

  switch (node.type) {
    case "section":
    case "container":
    case "card":
    case "columns":
      return `<div${styleAttr}>\n${children}\n</div>`;

    case "heading": {
      const level = node.props.level || 2;
      const tag = `h${Math.min(Math.max(level, 1), 6)}`;
      return `<${tag}${styleAttr}>${escapeHtml(node.props.text || "")}</${tag}>`;
    }

    case "text":
      return `<p${styleAttr}>${escapeHtml(node.props.text || "")}</p>`;

    case "button":
      return `<a href="${escapeHtml(node.props.href || "#")}"${styleAttr}>${escapeHtml(node.props.text || "")}</a>`;

    case "image":
      return `<img src="${escapeHtml(node.props.src || "")}" alt="${escapeHtml(node.props.alt || "")}"${styleAttr} />`;

    case "input":
      return `<input type="${escapeHtml(node.props.inputType || "text")}" placeholder="${escapeHtml(node.props.placeholder || "")}" name="${escapeHtml(node.props.inputName || "")}"${styleAttr} />`;

    case "textarea":
      return `<textarea rows="${node.props.rows || 4}" placeholder="${escapeHtml(node.props.placeholder || "")}"${styleAttr}></textarea>`;

    case "form":
      return `<form${styleAttr}>\n${children}\n</form>`;

    case "spacer":
      return `<div${styleAttr}></div>`;

    case "divider":
      return `<hr${styleAttr} />`;

    case "link":
      return `<a href="${escapeHtml(node.props.href || "#")}"${styleAttr}>${escapeHtml(node.props.label || node.props.text || "")}</a>`;

    case "badge": {
      const variantColors: Record<string, string> = {
        default: "#888",
        success: "#22c55e",
        warning: "#eab308",
        error: "#ef4444",
        info: "#3b82f6",
      };
      const color = variantColors[node.props.badgeVariant || "default"] || "#888";
      return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:11px;font-weight:700;background-color:${color}33;color:${color}">${escapeHtml(node.props.text || "")}</span>`;
    }

    case "avatar":
      return `<div${styleAttr}>${node.props.avatarSrc ? `<img src="${escapeHtml(node.props.avatarSrc)}" alt="${escapeHtml(node.props.avatarName || "")}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover" />` : `<span>${escapeHtml(node.props.avatarName?.[0] || "?")}</span>`}</div>`;

    case "video":
      return `<video src="${escapeHtml(node.props.videoSrc || "")}" poster="${escapeHtml(node.props.videoPoster || "")}" controls${styleAttr}></video>`;

    case "navbar":
      return `<nav${styleAttr}>\n${children}\n</nav>`;

    case "footer":
      return `<footer${styleAttr}>\n${children}\n</footer>`;

    case "table": {
      const headers = (node.props.tableHeaders || []).map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      const rows = (node.props.tableRows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
      return `<table${styleAttr}><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    case "list": {
      const items = (node.props.listItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return `<ul${styleAttr}>${items}</ul>`;
    }

    case "checkbox":
      return `<label${styleAttr}><input type="checkbox" ${node.props.checked ? "checked" : ""} /> ${escapeHtml(node.props.label || "")}</label>`;

    case "accordion": {
      const items = (node.props.accordionItems || []).map((item, i) => `
        <details${i === 0 ? " open" : ""}>
          <summary style="cursor:pointer;padding:12px 16px;font-weight:600">${escapeHtml(item.title)}</summary>
          <div style="padding:0 16px 12px">${escapeHtml(item.content)}</div>
        </details>`).join("");
      return `<div${styleAttr}>${items}</div>`;
    }

    case "tabs": {
      const labels = (node.props.tabLabels || []).map((label, i) => `<button onclick="this.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));this.classList.add('active');this.parentElement.parentElement.querySelectorAll('.tab-panel').forEach(p=>p.style.display='none');this.parentElement.parentElement.querySelectorAll('.tab-panel')[${i}].style.display='block'" style="padding:8px 16px;border:none;background:none;cursor:pointer;border-bottom:2px solid ${i === (node.props.activeTab || 0) ? "#9b4dff" : "transparent"};color:${i === (node.props.activeTab || 0) ? "#9b4dff" : "inherit"}">${escapeHtml(label)}</button>`).join("");
      return `<div${styleAttr}><div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1)">${labels}</div>${children}</div>`;
    }

    case "icon":
      return `<span${styleAttr}>●</span>`;

    default:
      return `<div${styleAttr}>${children}</div>`;
  }
}

export function canvasToHtml(doc: CanvasDocument): string {
  const bodyContent = doc.rootNodeIds
    .map((rootId) => {
      const root = doc.nodes[rootId];
      return root ? nodeToHtml(root, doc) : "";
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Preview — ${escapeHtml(doc.route)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0b10;
    color: #f8f8f2;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  img { max-width: 100%; height: auto; }
  a { text-decoration: none; color: inherit; }
  button { font-family: inherit; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.08); }
  ul { list-style: none; }
  details summary { list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  .tab-panel { display: none; }
  .tab-panel:first-child { display: block; }
  input, textarea {
    font-family: inherit;
    outline: none;
  }
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
