/**
 * Canvas → HTML serializer
 *
 * Converts a CanvasDocument into a self-contained HTML string that can
 * be rendered inside an iframe for the Preview mode. This gives a true
 * browser-like preview of the page — real links, hover states, scrolling,
 * forms, etc. — without the builder outlines/handles.
 */

import type { CanvasDocument, CanvasNode, NodeStyles } from "./types";

/**
 * Options for the static export.
 *
 * `deploymentId` is injected by the publish pipeline for a real
 * deployment. It wires forms to the platform form backend
 * (/api/forms/submit). When omitted (builder preview), forms render a
 * graceful "connects on publish" state instead of posting anywhere.
 */
export interface CanvasExportOptions {
  deploymentId?: string;
}

interface ExportContext {
  deploymentId?: string;
  /** true while rendering children of a <form> node */
  inForm: boolean;
  sawForm: boolean;
}

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

function nodeToHtml(node: CanvasNode, doc: CanvasDocument, depth = 0, ex?: ExportContext): string {
  if (node.metadata?.hidden) return "";

  const ctx: ExportContext = ex ?? { inForm: false, sawForm: false };

  const styleStr = stylesToCSSString(node.styles);
  const styleAttr = styleStr ? ` style="${styleStr}"` : "";

  // Children inherit "inside a form"; the sawForm flag is shared
  // by reference so the document root learns which scripts to inject.
  const prevInForm = ctx.inForm;
  if (node.type === "form") ctx.inForm = true;
  const children = node.children
    .map((childId) => doc.nodes[childId])
    .filter(Boolean)
    .map((child) => nodeToHtml(child, doc, depth + 1, ctx))
    .join("\n");
  ctx.inForm = prevInForm;

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
      // Inside a form the button submits it; elsewhere it stays a link.
      if (ctx.inForm) {
        return `<button type="submit"${styleAttr}>${escapeHtml(node.props.text || "")}</button>`;
      }
      return `<a href="${escapeHtml(node.props.href || "#")}"${styleAttr}>${escapeHtml(node.props.text || "")}</a>`;

    case "image": {
      const src = node.props.src || "";
      if (!src) {
        // Empty slot: render a clean, clearly-labeled placeholder instead of
        // a broken <img src=""> frame. This is what the user sees in the
        // preview and in the published page until they add an image.
        const alt = escapeHtml(node.props.alt || "Image");
        return `<div${styleAttr} style="display:flex;align-items:center;justify-content:center;border:2px dashed #6b7280;border-radius:12px;min-height:120px;color:#9ca3af;font-size:13px;font-family:system-ui,sans-serif">Add image — ${alt}</div>`;
      }
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.props.alt || "")}"${styleAttr} />`;
    }

    case "input":
      return `<input type="${escapeHtml(node.props.inputType || "text")}" placeholder="${escapeHtml(node.props.placeholder || "")}" name="${escapeHtml(node.props.inputName || "")}"${styleAttr} />`;

    case "textarea":
      return `<textarea rows="${node.props.rows || 4}" name="${escapeHtml(node.props.inputName || "")}" placeholder="${escapeHtml(node.props.placeholder || "")}"${styleAttr}></textarea>`;

    case "form": {
      // Platform form backend: submissions POST to /api/forms/submit and
      // land in the site owner's lead inbox. The hidden deploymentId ties
      // the submission to the published site; a honeypot field ("website")
      // silently drops bot submissions. An inline script (injected once per
      // document below) upgrades the submit to a JSON fetch with an inline
      // thank-you, so visitors never leave the page; without JS the plain
      // form POST still works.
      ctx.sawForm = true;
      const deploymentId = ctx.deploymentId ? escapeHtml(ctx.deploymentId) : "";
      const formName = escapeHtml(node.metadata?.name || "contact");
      const honeypot = `<input type="text" name="website" value="" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;opacity:0;height:0" aria-hidden="true" />`;
      return `<form action="/api/forms/submit" method="post" data-litt-form="1" data-litt-form-name="${formName}"${styleAttr}>\n<input type="hidden" name="deploymentId" value="${deploymentId}" />\n${honeypot}\n${children}\n</form>`;
    }

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

export function canvasToHtml(doc: CanvasDocument, opts?: CanvasExportOptions): string {
  const ctx: ExportContext = {
    deploymentId: opts?.deploymentId,
    inForm: false,
    sawForm: false,
  };

  const bodyContent = doc.rootNodeIds
    .map((rootId) => {
      const root = doc.nodes[rootId];
      return root ? nodeToHtml(root, doc, 0, ctx) : "";
    })
    .join("\n");

  // Inline behavior scripts — injected once per document, only when the
  // document actually contains the matching nodes. The functions are
  // serialized via .toString(), so they must stay self-contained (no
  // outer-scope references) and ES2017-safe.
  const scripts = [
    ctx.sawForm ? `<script>(${littFormInlineScript.toString()})();</script>` : "",
  ]
    .filter(Boolean)
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
${scripts}
</body>
</html>`;
}

/**
 * Upgrades exported platform forms: intercepts submit, POSTs JSON to
 * /api/forms/submit, and shows an inline thank-you without navigating.
 * Serialized into the HTML — keep self-contained, no outer references.
 */
function littFormInlineScript(): void {
  function showStatus(form: HTMLFormElement, msg: string): void {
    let el = form.querySelector("[data-litt-form-status]") as HTMLElement | null;
    if (!el) {
      el = document.createElement("p");
      el.setAttribute("data-litt-form-status", "1");
      el.setAttribute("style", "font-size:13px;opacity:0.75;margin-top:6px;");
      form.appendChild(el);
    }
    el.textContent = msg;
  }

  const forms = document.querySelectorAll("form[data-litt-form]");
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i] as HTMLFormElement;
    form.addEventListener("submit", function (e: Event) {
      e.preventDefault();
      const idInput = form.querySelector('input[name="deploymentId"]') as HTMLInputElement | null;
      const deploymentId = (idInput && idInput.value) || "";
      if (!deploymentId) {
        showStatus(form, "This form connects automatically when the site is published.");
        return;
      }
      const data = new FormData(form);
      const fields: Record<string, string> = {};
      data.forEach(function (v, k) {
        if (k === "deploymentId") return;
        fields[k] = String(v);
      });
      const payload = {
        deploymentId: deploymentId,
        formName: form.getAttribute("data-litt-form-name") || null,
        page: window.location.pathname || null,
        fields: fields,
        website: fields["website"] || "",
      };
      const btn = form.querySelector('[type="submit"]') as HTMLElement | null;
      if (btn) btn.setAttribute("disabled", "disabled");
      showStatus(form, "Sending…");
      fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { httpOk: r.ok, body: j as { ok?: boolean } | null };
          });
        })
        .then(function (res) {
          if (res.httpOk && res.body && res.body.ok === true) {
            form.innerHTML =
              '<div style="padding:24px;text-align:center">' +
              '<p style="font-size:18px;font-weight:700;margin-bottom:8px">Thanks — message received.</p>' +
              '<p style="opacity:0.7">We\'ll be in touch shortly.</p></div>';
          } else {
            showStatus(form, "Something went wrong — please try again.");
            if (btn) btn.removeAttribute("disabled");
          }
        })
        .catch(function () {
          showStatus(form, "Something went wrong — please try again.");
          if (btn) btn.removeAttribute("disabled");
        });
    });
  }
}
