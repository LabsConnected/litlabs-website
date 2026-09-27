/**
 * element-edits — the real "edit the selected preview element" write path.
 *
 * Studio-generated projects are static HTML (index.html + style.css +
 * script.js) — the preview iframe renders exactly what sits in the
 * workspace files, so a selected element's CSS selector resolves inside
 * the source file itself. This module is the pure half: parse → locate →
 * verify → patch → serialize. The hook (useElementEdits) owns fetching,
 * writing, undo, and the files-changed notification.
 *
 * Honest-by-construction rules:
 *   - A patch is only applied when the element resolves UNIQUELY in the
 *     file AND its tagName matches the preview's selected element.
 *   - If the selector is ambiguous, the stronger `path` chain (incl.
 *     html/body ancestors) is tried; if still ambiguous we refuse —
 *     never patch the wrong node.
 *   - No JSX/TSX/support files are touched: only .html sources parse
 *     through DOMParser deterministically. Framework elements surface
 *     the "not directly editable" state instead of a fake control.
 */

export interface ElementIdentity {
  selector: string;
  tagName: string;
  label?: string;
  attrs?: Record<string, string>;
  text?: string;
  /** Full ancestor chain incl. html/body — more reliable than selector. */
  path?: string;
}

export interface ElementPatch {
  /** Replace textContent (removes children). null/undefined = untouched. */
  text?: string;
  /** Set or remove attributes — null removes the attribute. */
  attrs?: Record<string, string | null>;
  /** Set or remove inline style declarations — null removes the prop. */
  styles?: Record<string, string | null>;
  /** Remove the element entirely. */
  remove?: boolean;
  /** Duplicate the element after itself. */
  duplicate?: boolean;
}

export interface ElementPatchResult {
  ok: boolean;
  html: string;
  /** Human-readable list of applied changes — for the edit history. */
  changed: string[];
  error?: string;
}

/** Files a previewed element could live in, best-first. `route` is the
    previewed path ("/" → index.html); the workspace .html list fills in
    any page the route math missed. */
export function candidateHtmlFiles(route: string | null | undefined, allFiles: string[]): string[] {
  const html = allFiles.filter((f) => f.toLowerCase().endsWith(".html"));
  const out: string[] = [];
  const push = (f: string) => { if (html.includes(f) && !out.includes(f)) out.push(f); };

  const normalized = (route ?? "/").split("?")[0].replace(/\/+$/, "").replace(/^\//, "");
  if (normalized) {
    push(`${normalized}.html`);
    push(`${normalized}/index.html`);
    push(`pages/${normalized}.html`);
    push(`public/${normalized}.html`);
  }
  push("index.html");
  push("public/index.html");
  push("src/index.html");
  for (const f of html) push(f); // catch-all: any other page file
  return out;
}

function matchesIdentity(el: Element, sel: ElementIdentity): boolean {
  if (el.tagName.toLowerCase() !== sel.tagName.toLowerCase()) return false;
  // When the bridge captured identifying attributes, they must agree —
  // a selector can hit a DIFFERENT element than the one the user clicked
  // in a dev-server-transformed DOM (e.g. React StrictMode wrappers).
  const id = sel.attrs?.["id"];
  if (id && el.getAttribute("id") !== id) return false;
  const testId = sel.attrs?.["data-testid"];
  if (testId && el.getAttribute("data-testid") !== testId) return false;
  const cls = sel.attrs?.["class"];
  if (cls && el.getAttribute("class") !== cls) return false;
  return true;
}

/**
 * Locate the element in the document. Order:
 *   1. `path` chain (html>body>…>:nth-of-type) — most stable.
 *   2. `selector` — must resolve to exactly one match.
 *   3. unique-attribute lookup (id / data-testid from the bridge attrs).
 * Returns null when nothing resolves uniquely and verifiably.
 */
export function locateElement(doc: Document, sel: ElementIdentity): Element | null {
  const tryQuery = (q: string | undefined): Element | null => {
    if (!q) return null;
    try {
      const hits = Array.from(doc.querySelectorAll(q));
      const verified = hits.filter((el) => matchesIdentity(el, sel));
      return verified.length === 1 ? verified[0] : null;
    } catch {
      return null; // invalid selector syntax — never trust it
    }
  };

  return tryQuery(sel.path) ?? tryQuery(sel.selector) ?? byUniqueAttr(doc, sel);
}

function byUniqueAttr(doc: Document, sel: ElementIdentity): Element | null {
  const id = sel.attrs?.["id"];
  if (id) {
    try {
      const el = doc.getElementById(id);
      if (el && matchesIdentity(el, sel)) return el;
    } catch { /* fall through */ }
  }
  const testId = sel.attrs?.["data-testid"];
  if (testId) {
    try {
      const hits = Array.from(doc.querySelectorAll(`[data-testid="${CSS.escape(testId)}"]`));
      const verified = hits.filter((el) => matchesIdentity(el, sel));
      if (verified.length === 1) return verified[0];
    } catch { /* fall through */ }
  }
  return null;
}

/**
 * Apply a patch to the located element inside `html`. Returns the full
 * rewritten document. Failure is honest: { ok:false, error } — the caller
 * must surface it, never pretend a write happened.
 */
export function applyElementPatch(html: string, sel: ElementIdentity, patch: ElementPatch): ElementPatchResult {
  if (!html.trim()) return { ok: false, html, changed: [], error: "Empty document" };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { ok: false, html, changed: [], error: "Document is not parseable HTML" };
  }
  // parseFromString always yields a document; a parsererror element marks
  // malformed markup — refuse rather than silently re-serialize.
  if (doc.querySelector("parsererror")) {
    return { ok: false, html, changed: [], error: "Document is not parseable HTML" };
  }

  const el = locateElement(doc, sel);
  if (!el) {
    return {
      ok: false,
      html,
      changed: [],
      error: `Couldn't uniquely match <${sel.tagName}> in this file — the preview DOM may be transformed. Use Ask LiTT instead.`,
    };
  }

  const changed: string[] = [];

  if (patch.text != null && el.textContent !== patch.text) {
    el.textContent = patch.text;
    changed.push(`text → "${patch.text.slice(0, 48)}"`);
  }

  for (const [name, value] of Object.entries(patch.attrs ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9-_:]*$/.test(name)) continue; // attribute-name sanity
    const prev = el.getAttribute(name);
    if (value == null) {
      if (prev != null) { el.removeAttribute(name); changed.push(`-${name}`); }
    } else if (prev !== value) {
      el.setAttribute(name, value);
      changed.push(`${name}="${value.slice(0, 48)}"`);
    }
  }

  for (const [prop, value] of Object.entries(patch.styles ?? {})) {
    if (!/^[a-z-]+$/i.test(prop)) continue; // style-prop sanity
    if (value == null || value === "") {
      if (el.getAttribute("style") != null) { (el as HTMLElement).style.removeProperty(prop); changed.push(`-${prop}`); }
    } else {
      (el as HTMLElement).style.setProperty(prop, value);
      changed.push(`${prop}: ${value.slice(0, 48)}`);
    }
  }

  if (patch.remove) {
    el.remove();
    changed.push(`removed <${sel.tagName}>`);
  } else if (patch.duplicate) {
    const clone = el.cloneNode(true);
    el.parentNode?.insertBefore(clone, el.nextSibling);
    changed.push(`duplicated <${sel.tagName}>`);
  }

  if (changed.length === 0) {
    return { ok: true, html, changed: [], error: "No change" };
  }

  const doctype = html.trimStart().toLowerCase().startsWith("<!doctype") ? "<!DOCTYPE html>\n" : "";
  return { ok: true, html: `${doctype}${doc.documentElement.outerHTML}`, changed };
}

/** Whether a file is a candidate for direct element editing. Only
    extension-gated — the content parse happens in applyElementPatch. */
export function isEditableSourceFile(path: string): boolean {
  return /\.(html?|svg)$/i.test(path);
}

/** Short truthful description for the undo stack + history list. */
export function describePatch(patch: ElementPatch): string {
  const bits: string[] = [];
  if (patch.text != null) bits.push("text");
  const attrs = Object.keys(patch.attrs ?? {});
  if (attrs.length) bits.push(attrs.join(", "));
  const styles = Object.keys(patch.styles ?? {});
  if (styles.length) bits.push(styles.map((s) => s.split("-")[0]).join("+"));
  if (patch.remove) bits.push("remove");
  if (patch.duplicate) bits.push("duplicate");
  return bits.join(" · ") || "edit";
}
