/**
 * element-tree — build a page-structure tree from a project's HTML
 * source file, with element identities in EXACTLY the format the
 * preview inspector bridge produces (terminal-server/preview/
 * inspector.ts: selectorFor / pathFor / describe / attrs capture).
 *
 * Why this exists: the Canvas & Design stage used to show a project
 * ONLY through the live preview iframe, so with no running preview
 * the stage had no project content at all (audit 2026-11-19: "the
 * Design canvas [was] empty without a running preview"; walkthrough
 * 2026-11-20: "Canvas renders blank"). The structure tree is derived
 * from the project's actual entry HTML file instead — it renders
 * with no preview running, and clicking a node produces the same
 * identity a click in the preview frame would, so the element
 * inspector + the element-edits write path resolve it identically
 * (locateElement in element-edits.ts).
 *
 * Styles are the element's INLINE styles parsed from its `style`
 * attribute — the values the source itself declares. Computed /
 * cascaded styles only exist in a live frame; those arrive with a
 * real preview selection, never fabricated here.
 */

import type { ElementIdentity } from "./element-edits";

export interface ElementTreeNode extends ElementIdentity {
  /** The bridge `path` chain — unique within the document. */
  key: string;
  label: string;
  /** Inline styles parsed from the element's style attribute. */
  styles?: Record<string, string>;
  children: ElementTreeNode[];
  /** Direct text of this element only (not descendants'), trimmed. */
  ownText?: string;
}

/** Attribute props the bridge captures (inspector.ts ATTR_PROPS). */
const ATTR_PROPS = [
  "id", "class", "data-testid", "src", "href", "alt", "role",
  "aria-label", "type", "name", "value", "placeholder",
] as const;

/** Style props the bridge captures (inspector.ts STYLE_PROPS). */
const STYLE_PROPS = [
  "color", "background-color", "font-size", "font-weight", "font-style",
  "line-height", "letter-spacing", "text-align", "padding", "margin",
  "display", "gap", "justify-content", "align-items", "border",
  "border-radius", "width", "height", "opacity",
] as const;

const SEMANTIC_LABELS: Record<string, string> = {
  nav: "Navigation",
  header: "Header",
  main: "Main content",
  footer: "Footer",
  form: "Form",
  button: "Button",
  a: "Link",
  img: "Image",
  h1: "Heading",
  h2: "Heading",
  section: "Section",
};

/** Tags that never render as page structure. */
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "link", "meta", "title",
  "head", "base",
]);

const MAX_DEPTH = 14;
const MAX_NODES = 500;

function sameTagSiblings(el: Element): Element[] {
  const parent = el.parentElement;
  if (!parent) return [el];
  return Array.from(parent.children).filter((c) => c.tagName === el.tagName);
}

function chainPart(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const siblings = sameTagSiblings(el);
  const index = siblings.indexOf(el) + 1;
  return tag + (siblings.length > 1 ? `:nth-of-type(${index})` : "");
}

/** Mirror of the bridge's selectorFor (inspector.ts). */
export function selectorForElement(el: Element): string {
  if (el.id) return `#${el.id}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (
    current &&
    current.tagName &&
    current.tagName.toLowerCase() !== "body" &&
    parts.length < 4
  ) {
    parts.unshift(chainPart(current));
    current = current.parentElement;
  }
  return (parts.join(" > ") || el.tagName.toLowerCase()).slice(0, 400);
}

/** Mirror of the bridge's pathFor (inspector.ts) — includes html/body. */
export function pathForElement(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.tagName && parts.length < 8) {
    parts.unshift(chainPart(current));
    current = current.parentElement;
  }
  return parts.join(" > ").slice(0, 600);
}

/** Mirror of the bridge's describe() label. */
export function labelForElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (SEMANTIC_LABELS[tag]) return SEMANTIC_LABELS[tag];
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return (text ? text.slice(0, 42) : tag).slice(0, 120);
}

export function attrsForElement(el: Element): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  for (const prop of ATTR_PROPS) {
    const v = el.getAttribute(prop);
    if (v != null && v !== "") attrs[prop] = String(v).slice(0, 200);
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/** Parse the element's inline `style` attribute, keeping only the
    style props the bridge/inspector work with. */
export function inlineStylesForElement(el: Element): Record<string, string> | undefined {
  const raw = el.getAttribute("style");
  if (!raw) return undefined;
  const styles: Record<string, string> = {};
  for (const decl of raw.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (value && (STYLE_PROPS as readonly string[]).includes(prop)) {
      styles[prop] = value.slice(0, 120);
    }
  }
  return Object.keys(styles).length > 0 ? styles : undefined;
}

function ownTextOf(el: Element): string | undefined {
  let text = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += n.textContent ?? "";
  });
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

function fullTextOf(el: Element): string | undefined {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : undefined;
}

/**
 * Build the structure tree for a parsed document. Roots are the
 * body's element children (falling back to the document element's).
 * Returns [] for a document with no renderable structure.
 */
export function buildElementTree(doc: Document): ElementTreeNode[] {
  const root: Element | null = doc.body ?? doc.documentElement;
  if (!root) return [];
  let count = 0;

  const build = (el: Element, depth: number): ElementTreeNode | null => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    if (count >= MAX_NODES) return null;
    count += 1;
    const path = pathForElement(el);
    const children: ElementTreeNode[] = [];
    if (depth < MAX_DEPTH) {
      el.childNodes.forEach((n) => {
        if (n.nodeType === 1) {
          const child = build(n as Element, depth + 1);
          if (child) children.push(child);
        }
      });
    }
    return {
      key: path,
      label: labelForElement(el),
      selector: selectorForElement(el),
      tagName: tag,
      attrs: attrsForElement(el),
      styles: inlineStylesForElement(el),
      text: fullTextOf(el),
      ownText: ownTextOf(el),
      path,
      children,
    };
  };

  const roots: ElementTreeNode[] = [];
  Array.from(root.children).forEach((child) => {
    // When the root is <html> (no body), its <head> is skipped by
    // SKIP_TAGS and <body> itself becomes the single root's child —
    // unwrap it so the tree starts at the page's real sections.
    if (child.tagName.toLowerCase() === "body") {
      Array.from(child.children).forEach((inner) => {
        const node = build(inner, 0);
        if (node) roots.push(node);
      });
      return;
    }
    const node = build(child, 0);
    if (node) roots.push(node);
  });
  return roots;
}

/**
 * Parse an HTML source string and build its structure tree.
 * Returns null when the source does not parse as HTML.
 */
export function buildStructureTree(html: string): ElementTreeNode[] | null {
  if (!html.trim()) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  if (doc.querySelector("parsererror")) return null;
  return buildElementTree(doc);
}
