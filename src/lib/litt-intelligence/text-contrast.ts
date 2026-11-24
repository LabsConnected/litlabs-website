/**
 * ACC-02 Defect A — invisible-text verification for generated pages.
 *
 * The failure (staging Acceptance Run 2, 2026-11-24, release 9f8501ee):
 * a freshly generated one-page bakery site shipped with its hero
 * tagline and opening-hours times INVISIBLE — present in the served
 * HTML, reported as done, but rendered light-on-light in Studio
 * preview, Static View, and the live published site. The run's own
 * closing message described a "glassmorphic dark theme … near-black
 * background (#03050a)", yet the delivered document's effective
 * background stayed light: the model declared text colors for the
 * dark theme it intended while the dark background never took effect
 * in the document it actually wrote.
 *
 * Nothing in the pipeline compared the two halves of that pair: the
 * write path validates placeholders and rewrites, the enrichment pass
 * resolves images, the build-fix loop skips static workspaces, the
 * visual judge is never attempted for static workspaces ("verified by
 * read-back instead"), and the F9 read-back checks that text EXISTS —
 * the tagline existed. This module is the missing read-back: it checks
 * that text would be VISIBLE under the colors the document itself
 * declares.
 *
 * Deliberately conservative, in the F9 mold:
 *
 *   - It reasons ONLY about the generated document itself: its own
 *     <style> blocks and inline style attributes. A document whose
 *     colors may live elsewhere — a linked local stylesheet, an
 *     @import, a prefers-color-scheme media block — is not reasoned
 *     about at all.
 *   - ACC-03 (Run 1 on 055ae851): the Tailwind browser runtime is no
 *     longer a silent pass. A page whose theme lives ONLY in a
 *     <style type="text/tailwindcss"> @apply block ships or breaks
 *     with the runtime compiler — the run's page declared white text
 *     over bg-[--color-background], which Tailwind v4 compiles to an
 *     invalid declaration the browser drops, leaving invisible text
 *     on every serve path. So when the runtime decides colors, the
 *     checker either judges the narrow shape it can soundly model
 *     (the html/body @apply rule and a closed set of color utilities,
 *     with the v3 bg-[--x] shorthand treated as the dropped no-op it
 *     compiles to) or reports the document UNVERIFIABLE
 *     (unreasonedReason "tailwind-runtime") — and the wiring treats
 *     unverifiable exactly like the truncated case: repair feedback,
 *     then an honest non-clean settlement. Never a silent clean.
 *   - An element is only judged when BOTH its effective text color
 *     and the effective background behind it resolve to concrete
 *     colors through the document's own cascade (tag/class/id
 *     selectors, descendant/child combinators, inheritance, CSS
 *     custom properties). Gradients, images, unresolved var()s and
 *     unrecognized color formats make the element unjudgeable, and
 *     unjudgeable elements are skipped — never failed.
 *   - It only fires on CLEAR cases: a WCAG contrast ratio below 2:1
 *     (readable muted grays sit at 2.8:1 and above; near-white on
 *     white is ~1.1:1). A missed catch is acceptable; a false failure
 *     on a good page is not.
 *   - Intentionally hidden text (display:none, visibility:hidden,
 *     opacity:0, the hidden attribute) and gradient-clipped text
 *     (background-clip:text) are not defects and are skipped.
 */

import { parse } from "parse5";

// ─── Public shapes ───────────────────────────────────────────────────

export interface ContrastViolation {
  /** Workspace-relative path of the HTML file. */
  path: string;
  /** Element descriptor, e.g. `p.tagline` or `span.hours-time`. */
  element: string;
  /** The invisible text itself (whitespace-normalized, truncated). */
  text: string;
  /** Effective text color, as a #rrggbb hex string. */
  color: string;
  /** Effective background behind the text, as a #rrggbb hex string. */
  background: string;
  /** WCAG contrast ratio of color on background, 2 decimal places. */
  ratio: number;
}

export interface TextContrastCheck {
  /** True when at least one mutated HTML file could be read back and
   *  the evidence is complete: when the candidate cap truncated the
   *  set and no violation was found, the outcome is unknown and this
   *  is false — absence of evidence never fails a run (F9's rule).
   *  ACC-03: a found UNVERIFIABLE file is also evidence the check
   *  applies — the run must hear about it, not pass in silence. */
  applies: boolean;
  /** Clear invisible-text violations found in the checked files. */
  violations: ContrastViolation[];
  /** Files actually read and checked. */
  checkedFiles: string[];
  /** Checked files whose colors are decided by the Tailwind browser
   *  runtime in shapes the checker cannot soundly judge (ACC-03).
   *  An unverifiable file is NOT a clean file: the loop wiring gives
   *  it the same repair-feedback-then-honest-failure treatment as a
   *  violation, with its own message. */
  unverifiableFiles: string[];
}

// ─── Color parsing ───────────────────────────────────────────────────

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], silver: [192, 192, 192], gray: [128, 128, 128],
  grey: [128, 128, 128], white: [255, 255, 255], maroon: [128, 0, 0],
  red: [255, 0, 0], purple: [128, 0, 128], fuchsia: [255, 0, 255],
  magenta: [255, 0, 255], green: [0, 128, 0], lime: [0, 255, 0],
  olive: [128, 128, 0], yellow: [255, 255, 0], navy: [0, 0, 128],
  blue: [0, 0, 255], teal: [0, 128, 128], aqua: [0, 255, 255],
  cyan: [0, 255, 255], orange: [255, 165, 0], aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215], beige: [245, 245, 220],
  bisque: [255, 228, 196], blanchedalmond: [255, 235, 205],
  brown: [165, 42, 42], burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160], chocolate: [210, 105, 30],
  coral: [255, 127, 80], cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220], crimson: [220, 20, 60],
  darkblue: [0, 0, 139], darkcyan: [0, 139, 139],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  darkgreen: [0, 100, 0], darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139], darkorange: [255, 140, 0],
  darkred: [139, 0, 0], darksalmon: [233, 150, 122],
  darkslateblue: [72, 61, 139], darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79], darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211], deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255], dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105], dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34], floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34], gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255], gold: [255, 215, 0],
  goldenrod: [218, 165, 32], honeydew: [240, 255, 240],
  hotpink: [255, 105, 180], indianred: [205, 92, 92],
  indigo: [75, 0, 130], ivory: [255, 255, 240],
  khaki: [240, 230, 140], lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245], lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205], lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128], lightcyan: [224, 255, 255],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  lightgreen: [144, 238, 144], lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122], lightskyblue: [135, 206, 250],
  lightsteelblue: [176, 196, 222], lightyellow: [255, 255, 224],
  limegreen: [50, 205, 50], linen: [250, 240, 230],
  mediumblue: [0, 0, 205], mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113], mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154], mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133], midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250], mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181], navajowhite: [255, 222, 173],
  oldlace: [253, 245, 230], olivedrab: [107, 142, 35],
  orangered: [255, 69, 0], orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170], palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238], palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213], peachpuff: [255, 218, 185],
  peru: [205, 133, 63], pink: [255, 192, 203], plum: [221, 160, 221],
  powderblue: [176, 224, 230], rebeccapurple: [102, 51, 153],
  rosybrown: [188, 143, 143], royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19], salmon: [250, 128, 114],
  sandybrown: [244, 164, 96], seagreen: [46, 139, 87],
  seashell: [255, 245, 238], sienna: [160, 82, 45],
  skyblue: [135, 206, 235], slateblue: [106, 90, 205],
  slategray: [112, 128, 144], slategrey: [112, 128, 144],
  snow: [255, 250, 250], springgreen: [0, 255, 127],
  steelblue: [70, 130, 180], tan: [210, 180, 140],
  thistle: [216, 191, 216], tomato: [255, 99, 71],
  turquoise: [64, 224, 208], violet: [238, 130, 238],
  wheat: [245, 222, 179], whitesmoke: [245, 245, 245],
  yellowgreen: [154, 205, 50],
};

function clampChannel(n: number): number {
  return Math.min(255, Math.max(0, n));
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  if (sat === 0) {
    const v = clampChannel(Math.round(lig * 255));
    return [v, v, v];
  }
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const conv = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    clampChannel(Math.round(conv(hue + 1 / 3) * 255)),
    clampChannel(Math.round(conv(hue) * 255)),
    clampChannel(Math.round(conv(hue - 1 / 3) * 255)),
  ];
}

function parseChannel(token: string): number | null {
  const t = token.trim();
  if (t.endsWith("%")) {
    const n = Number.parseFloat(t.slice(0, -1));
    return Number.isFinite(n) ? clampChannel(Math.round(n / 100 * 255)) : null;
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? clampChannel(Math.round(n)) : null;
}

function parseAlpha(token: string): number | null {
  const t = token.trim();
  if (t.endsWith("%")) {
    const n = Number.parseFloat(t.slice(0, -1));
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : null;
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** Parse a CSS color value to RGBA, or null when the value is not a
 *  concrete color this checker can reason about (var() leftovers,
 *  currentColor, unknown keywords, malformed functions). */
export function parseCssColor(raw: string): Rgba | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[value];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const r = Number.parseInt(h[0] + h[0], 16);
      const g = Number.parseInt(h[1] + h[1], 16);
      const b = Number.parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? Number.parseInt(h[3] + h[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (h.length === 6 || h.length === 8) {
      const r = Number.parseInt(h.slice(0, 2), 16);
      const g = Number.parseInt(h.slice(2, 4), 16);
      const b = Number.parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (fn) {
    const kind = fn[1];
    const inner = fn[2].replace(/\//g, " ").replace(/,/g, " ");
    const parts = inner.split(/\s+/).filter((p) => p.length > 0);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const alpha = parts.length === 4 ? parseAlpha(parts[3]) : 1;
    if (alpha === null) return null;
    if (kind.startsWith("rgb")) {
      const r = parseChannel(parts[0]);
      const g = parseChannel(parts[1]);
      const b = parseChannel(parts[2]);
      if (r === null || g === null || b === null) return null;
      return { r, g, b, a: alpha };
    }
    const hNum = Number.parseFloat(parts[0].replace(/deg$/, ""));
    const sNum = parts[1].endsWith("%") ? Number.parseFloat(parts[1]) / 100 : Number.NaN;
    const lNum = parts[2].endsWith("%") ? Number.parseFloat(parts[2]) / 100 : Number.NaN;
    if (!Number.isFinite(hNum) || !Number.isFinite(sNum) || !Number.isFinite(lNum)) return null;
    const [r, g, b] = hslToRgb(hNum, sNum, lNum);
    return { r, g, b, a: alpha };
  }

  return null;
}

function toHex(c: Rgba): string {
  const part = (n: number) => clampChannel(Math.round(n)).toString(16).padStart(2, "0");
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

function relativeLuminance(c: Rgba): number {
  const lin = (n: number) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio between two opaque colors, 1..21. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  };
}

// ─── CSS parsing (the document's own <style> blocks only) ──────────

interface CssDeclaration {
  value: string;
  important: boolean;
  /** Position of this declaration in its source (stylesheet or
   *  style attribute), monotonically increasing. Cascade order is
   *  per-DECLARATION, not per-rule: inside one block, a later
   *  `background` must beat an earlier `background-color`. */
  seq: number;
}

interface CompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
}

interface ComplexSelector {
  compounds: CompoundSelector[];
  /** combinators[i] joins compounds[i] (left) to compounds[i+1]. */
  combinators: Array<" " | ">">;
  specificity: [number, number, number];
}

interface CssRule {
  selectors: ComplexSelector[];
  declarations: Map<string, CssDeclaration>;
  order: number;
}

function parseDeclarations(
  body: string,
  counter: { next: number },
): Map<string, CssDeclaration> {
  const out = new Map<string, CssDeclaration>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const rawProp = part.slice(0, colon).trim();
    if (!rawProp) continue;
    // Standard property names are case-insensitive; custom property
    // names are NOT — --bg and --BG are different properties, and
    // lowercasing would merge them into one.
    const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();
    let value = part.slice(colon + 1).trim();
    let important = false;
    const imp = /!important\s*$/i.exec(value);
    if (imp) {
      important = true;
      value = value.slice(0, imp.index).trim();
    }
    if (value) out.set(prop, { value, important, seq: counter.next++ });
  }
  return out;
}

function parseCompoundSelector(raw: string): CompoundSelector | null {
  let rest = raw.trim();
  if (rest === ":root") return { tag: "html", id: null, classes: [] };
  if (!rest) return null;
  let tag: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];
  const tagMatch = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
  if (tagMatch) {
    tag = tagMatch[1] === "*" ? null : tagMatch[1].toLowerCase();
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    const m = /^([.#])([a-zA-Z0-9_-]+)/.exec(rest);
    if (!m) return null; // pseudo, attribute, or anything fancier — unsupported
    if (m[1] === ".") classes.push(m[2]);
    else id = m[2];
    rest = rest.slice(m[0].length);
  }
  return { tag, id, classes };
}

function parseComplexSelector(raw: string): ComplexSelector | null {
  const text = raw.trim();
  if (!text) return null;
  if (/[+~[\]:"']/.test(text.replace(/:root\b/g, ""))) return null;
  const tokens = text.replace(/>/g, " > ").split(/\s+/).filter((t) => t.length > 0);
  const compounds: CompoundSelector[] = [];
  const combinators: Array<" " | ">"> = [];
  let pendingChild = false;
  for (const token of tokens) {
    if (token === ">") {
      pendingChild = true;
      continue;
    }
    const compound = parseCompoundSelector(token);
    if (!compound) return null;
    if (compounds.length > 0) combinators.push(pendingChild ? ">" : " ");
    compounds.push(compound);
    pendingChild = false;
  }
  if (compounds.length === 0 || pendingChild) return null;
  let ids = 0;
  let cls = 0;
  let tags = 0;
  for (const c of compounds) {
    if (c.id) ids += 1;
    cls += c.classes.length;
    if (c.tag) tags += 1;
  }
  return { compounds, combinators, specificity: [ids, cls, tags] };
}

/** Every property this checker reads while judging an element. A
 *  rule the parser must skip is only safe to skip when it declares
 *  none of these (and no custom property): otherwise the skipped
 *  rule could be the one carrying the colors being judged. */
const COLOR_RELEVANT_PROPS = new Set([
  "color", "background", "background-color", "background-image",
  "background-clip", "-webkit-background-clip",
  "display", "visibility", "opacity",
]);

function declarationsAffectColors(declarations: Map<string, CssDeclaration>): boolean {
  for (const prop of declarations.keys()) {
    if (prop.startsWith("--") || COLOR_RELEVANT_PROPS.has(prop)) return true;
  }
  return false;
}

/** The same test against raw CSS text, for constructs the flat
 *  parser cannot decompose (at-rule blocks, nested rules). */
function textMentionsColorDeclarations(text: string): boolean {
  return (
    /(?:^|[;{])\s*(?:color|background|background-color|background-image|background-clip|-webkit-background-clip|display|visibility|opacity)\s*:/i.test(text)
    || /(?:^|[;{])\s*--[a-zA-Z0-9_-]+\s*:/.test(text)
  );
}

/**
 * Parse a stylesheet into flat rules. Constructs this flat view
 * cannot see — at-rule blocks, nested rules, selectors beyond its
 * grammar (attribute selectors, pseudo-classes) — are skipped, and
 * the caller is told when a skipped construct may carry color
 * declarations, because then the document is beyond this checker:
 * judging it anyway would mean judging against defaults the skipped
 * CSS may override.
 */
function parseStylesheet(css: string): { rules: CssRule[]; opaque: boolean } {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let opaque = false;
  let order = 0;
  const seqCounter = { next: 0 };
  let i = 0;
  const n = text.length;
  while (i < n) {
    // Skip whitespace and stray semicolons.
    while (i < n && /[\s;]/.test(text[i])) i += 1;
    if (i >= n) break;
    if (text[i] === "@") {
      // At-rule: skip to ';' (statement) or past its balanced block.
      let j = i;
      while (j < n && text[j] !== "{" && text[j] !== ";") j += 1;
      const prelude = text.slice(i, j);
      if (j < n && text[j] === "{") {
        let depth = 0;
        let k = j;
        while (k < n) {
          if (text[k] === "{") depth += 1;
          else if (text[k] === "}") {
            depth -= 1;
            if (depth === 0) break;
          }
          k += 1;
        }
        const block = text.slice(j, k + 1);
        if (
          /prefers-color-scheme/i.test(prelude)
          || /background/i.test(block)
          || textMentionsColorDeclarations(block)
        ) {
          opaque = true;
        }
        i = k + 1;
      } else {
        i = j + 1;
      }
      continue;
    }
    // Style rule: selector text up to '{', body up to matching '}'.
    let j = i;
    while (j < n && text[j] !== "{" && text[j] !== "}") j += 1;
    if (j >= n || text[j] !== "{") break;
    const selectorText = text.slice(i, j);
    let depth = 0;
    let k = j;
    while (k < n) {
      if (text[k] === "{") depth += 1;
      else if (text[k] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      k += 1;
    }
    const body = text.slice(j + 1, k);
    i = k + 1;
    if (body.includes("{")) {
      // Nested rules — beyond this checker. If the nested content
      // may carry colors, the document is too, rather than judged
      // without them.
      if (textMentionsColorDeclarations(body)) opaque = true;
      continue;
    }
    const declarations = parseDeclarations(body, seqCounter);
    if (declarations.size === 0) continue;
    const parsedSelectors = selectorText.split(",").map((s) => parseComplexSelector(s));
    const selectors = parsedSelectors.filter((s): s is ComplexSelector => s !== null);
    // A selector this grammar cannot read (an attribute selector, a
    // pseudo-class, a sibling combinator) drops out of the rule. If
    // the rule declares colors, the dropped selector might be the
    // one matching the judged elements — the document is beyond
    // this checker rather than judged on a partial cascade.
    if (selectors.length < parsedSelectors.length && declarationsAffectColors(declarations)) {
      opaque = true;
    }
    if (selectors.length === 0) continue;
    rules.push({ selectors, declarations, order: order++ });
  }
  return { rules, opaque };
}

// ─── DOM walking (parse5 tree, structurally typed) ──────────────────

interface P5Node {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
  parentNode?: P5Node | null;
  value?: string;
}

const SKIP_SUBTREE_TAGS = new Set([
  "head", "script", "style", "noscript", "template", "svg", "title",
  "meta", "link", "base",
]);

/** Form controls render through UA styling this checker cannot see. */
const SKIP_ELEMENT_TAGS = new Set(["input", "textarea", "select", "option", "img", "br", "wbr", "hr"]);

function attrOf(el: P5Node, name: string): string | null {
  const found = (el.attrs ?? []).find((a) => a.name === name);
  return found ? found.value : null;
}

function classListOf(el: P5Node): string[] {
  const raw = attrOf(el, "class");
  return raw ? raw.split(/\s+/).filter((c) => c.length > 0) : [];
}

function matchesCompound(el: P5Node, compound: CompoundSelector): boolean {
  if (compound.tag && (el.tagName ?? "").toLowerCase() !== compound.tag) return false;
  if (compound.id && attrOf(el, "id") !== compound.id) return false;
  if (compound.classes.length > 0) {
    const classes = classListOf(el);
    for (const c of compound.classes) {
      if (!classes.includes(c)) return false;
    }
  }
  return true;
}

function matchesSelector(el: P5Node, selector: ComplexSelector): boolean {
  const { compounds, combinators } = selector;
  let idx = compounds.length - 1;
  if (!matchesCompound(el, compounds[idx])) return false;
  let current: P5Node = el;
  while (idx > 0) {
    const combinator = combinators[idx - 1];
    idx -= 1;
    if (combinator === ">") {
      const parent = current.parentNode;
      if (!parent || !parent.tagName || !matchesCompound(parent, compounds[idx])) return false;
      current = parent;
    } else {
      let ancestor = current.parentNode;
      let found: P5Node | null = null;
      while (ancestor && ancestor.tagName) {
        if (matchesCompound(ancestor, compounds[idx])) {
          found = ancestor;
          break;
        }
        ancestor = ancestor.parentNode;
      }
      if (!found) return false;
      current = found;
    }
  }
  return true;
}

interface WinningDeclaration {
  value: string;
  important: boolean;
  inline: boolean;
  specificity: [number, number, number];
  order: number;
}

function compareDeclarations(a: WinningDeclaration, b: WinningDeclaration): number {
  if (a.important !== b.important) return a.important ? 1 : -1;
  if (a.inline !== b.inline) return a.inline ? 1 : -1;
  for (let i = 0; i < 3; i += 1) {
    if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] - b.specificity[i];
  }
  return a.order - b.order;
}

/** The cascaded winning declaration of one property on one element,
 *  from the document's rules plus the element's inline style. */
function winningDeclaration(
  el: P5Node,
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  property: string,
): WinningDeclaration | null {
  let best: WinningDeclaration | null = null;
  for (const rule of rules) {
    const decl = rule.declarations.get(property);
    if (!decl) continue;
    for (const selector of rule.selectors) {
      if (!matchesSelector(el, selector)) continue;
      const candidate: WinningDeclaration = {
        value: decl.value,
        important: decl.important,
        inline: false,
        specificity: selector.specificity,
        order: decl.seq,
      };
      if (!best || compareDeclarations(candidate, best) > 0) best = candidate;
    }
  }
  const inline = inlineStyles.get(el)?.get(property);
  if (inline) {
    const candidate: WinningDeclaration = {
      value: inline.value,
      important: inline.important,
      inline: true,
      specificity: [0, 0, 0],
      order: inline.seq,
    };
    if (!best || compareDeclarations(candidate, best) > 0) best = candidate;
  }
  return best;
}

/** Custom properties inherit: merge the winning --* declarations from
 *  the root element down to this element. */
function customPropertyScope(
  chain: P5Node[],
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
): Map<string, string> {
  const scope = new Map<string, string>();
  for (const el of chain) {
    const winners = new Map<string, WinningDeclaration>();
    const consider = (prop: string, cand: WinningDeclaration) => {
      const prev = winners.get(prop);
      if (!prev || compareDeclarations(cand, prev) > 0) winners.set(prop, cand);
    };
    for (const rule of rules) {
      let matched: ComplexSelector | null = null;
      for (const selector of rule.selectors) {
        if (matchesSelector(el, selector)) {
          matched = selector;
          break;
        }
      }
      if (!matched) continue;
      for (const [prop, decl] of rule.declarations) {
        if (!prop.startsWith("--")) continue;
        consider(prop, {
          value: decl.value,
          important: decl.important,
          inline: false,
          specificity: matched.specificity,
          order: decl.seq,
        });
      }
    }
    const inline = inlineStyles.get(el);
    if (inline) {
      for (const [prop, decl] of inline) {
        if (!prop.startsWith("--")) continue;
        consider(prop, {
          value: decl.value,
          important: decl.important,
          inline: true,
          specificity: [0, 0, 0],
          order: decl.seq,
        });
      }
    }
    for (const [prop, winner] of winners) scope.set(prop, winner.value);
  }
  return scope;
}

/** Substitute var(--name) / var(--name, fallback) from the scope.
 *  Returns null when a reference cannot be resolved. */
function resolveVars(value: string, scope: Map<string, string>): string | null {
  let current = value;
  for (let pass = 0; pass < 6; pass += 1) {
    if (!/var\(/i.test(current)) return current;
    let out = "";
    let i = 0;
    let failed = false;
    while (i < current.length) {
      const start = current.toLowerCase().indexOf("var(", i);
      if (start < 0) {
        out += current.slice(i);
        break;
      }
      out += current.slice(i, start);
      let depth = 0;
      let j = start;
      while (j < current.length) {
        if (current[j] === "(") depth += 1;
        else if (current[j] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        j += 1;
      }
      if (depth !== 0) return null;
      const inner = current.slice(start + 4, j);
      // Split name / fallback at the first top-level comma.
      let comma = -1;
      let innerDepth = 0;
      for (let k = 0; k < inner.length; k += 1) {
        if (inner[k] === "(") innerDepth += 1;
        else if (inner[k] === ")") innerDepth -= 1;
        else if (inner[k] === "," && innerDepth === 0) {
          comma = k;
          break;
        }
      }
      // Custom property names are case-sensitive: look the name up
      // exactly as written.
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
      if (!name.startsWith("--")) return null;
      const scoped = scope.get(name);
      if (scoped !== undefined) out += scoped;
      else if (fallback !== null && fallback !== "") out += fallback;
      else {
        failed = true;
        break;
      }
      i = j + 1;
    }
    if (failed) return null;
    current = out;
  }
  return /var\(/i.test(current) ? null : current;
}

// ─── The check itself ────────────────────────────────────────────────

/** Only ratios below this are called invisible — far under the WCAG
 *  AA floor (4.5) and under ordinary muted-gray styling (~2.8), so
 *  the check fires exclusively on text that effectively vanishes. */
const INVISIBLE_RATIO = 2.0;

const MAX_CHECKED_FILES = 8;
const MAX_VIOLATIONS_PER_FILE = 10;

type Resolved<T> = { kind: "value"; value: T } | { kind: "unknown" } | { kind: "none" };

function ancestorChain(el: P5Node): P5Node[] {
  const chain: P5Node[] = [];
  let current: P5Node | null = el;
  while (current && current.tagName) {
    chain.unshift(current);
    current = current.parentNode ?? null;
  }
  return chain;
}

/** Effective text color of an element: its own cascaded `color`, else
 *  inherited from the nearest ancestor that declares one, else the
 *  UA default (black). "unknown" when a declaration exists but its
 *  value cannot be resolved to a concrete color. Each ancestor's
 *  declaration is resolved in THAT ancestor's own custom-property
 *  scope (scopes[i] covers chain[0..i]): a var() resolves where the
 *  declaration lives, with values inherited down to it — a
 *  descendant's redefinition never reaches back up. */
function effectiveTextColor(
  chain: P5Node[],
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  scopes: Array<Map<string, string>>,
): Resolved<Rgba> {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const winner = winningDeclaration(chain[i], rules, inlineStyles, "color");
    if (!winner) continue;
    const resolved = resolveVars(winner.value, scopes[i]);
    if (resolved === null) return { kind: "unknown" };
    const keyword = resolved.trim().toLowerCase();
    if (keyword === "inherit" || keyword === "unset") continue;
    if (keyword === "initial") return { kind: "value", value: { r: 0, g: 0, b: 0, a: 1 } };
    const color = parseCssColor(resolved);
    if (!color) return { kind: "unknown" };
    return { kind: "value", value: color };
  }
  return { kind: "value", value: { r: 0, g: 0, b: 0, a: 1 } };
}

/** Split a background shorthand into tokens without breaking
 *  functional notation apart: rgb(3, 5, 10) is ONE token even though
 *  it contains spaces. Null when the parens are unbalanced — the
 *  value cannot be read at all. */
function shorthandTokens(value: string): string[] | null {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (/\s/.test(ch) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (depth !== 0) return null;
  if (current) tokens.push(current);
  return tokens;
}

/** One element's own background paint, before walking up. */
function ownBackground(
  el: P5Node,
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  scope: Map<string, string>,
): Resolved<Rgba> {
  const image = winningDeclaration(el, rules, inlineStyles, "background-image");
  if (image) {
    const resolved = resolveVars(image.value, scope);
    if (resolved === null) return { kind: "unknown" };
    if (resolved.trim().toLowerCase() !== "none") return { kind: "unknown" };
  }
  // background-color and the background shorthand compete in the
  // cascade for the color layer; the winner speaks for this element.
  const colorDecl = winningDeclaration(el, rules, inlineStyles, "background-color");
  const shorthandDecl = winningDeclaration(el, rules, inlineStyles, "background");
  let winner: WinningDeclaration | null = null;
  let isShorthand = false;
  if (colorDecl && shorthandDecl) {
    if (compareDeclarations(shorthandDecl, colorDecl) > 0) {
      winner = shorthandDecl;
      isShorthand = true;
    } else {
      winner = colorDecl;
    }
  } else if (shorthandDecl) {
    winner = shorthandDecl;
    isShorthand = true;
  } else if (colorDecl) {
    winner = colorDecl;
  }
  if (!winner) return { kind: "none" };
  const resolved = resolveVars(winner.value, scope);
  if (resolved === null) return { kind: "unknown" };
  const keyword = resolved.trim().toLowerCase();
  if (keyword === "inherit" || keyword === "unset") return { kind: "none" };
  if (isShorthand) {
    if (/url\(|gradient\(/i.test(resolved)) return { kind: "unknown" };
    // Extract the color token, if the shorthand carries one.
    const tokens = shorthandTokens(resolved);
    if (tokens === null) return { kind: "unknown" };
    for (const token of tokens) {
      const color = parseCssColor(token);
      if (color) return color.a === 0 ? { kind: "none" } : { kind: "value", value: color };
      // A token that TRIES to be a color but cannot be read — a hex
      // value of the wrong length, a malformed rgb()/hsl() — means
      // the shorthand's color layer is beyond this checker. Guessing
      // "no color here" would lose a real background and falsely
      // fail a readable page, so the element is unjudgeable.
      if (token.startsWith("#") || /^(rgba?|hsla?)\(/i.test(token)) return { kind: "unknown" };
    }
    return { kind: "none" }; // shorthand without a color resets to transparent
  }
  if (keyword === "initial") return { kind: "none" };
  const color = parseCssColor(resolved);
  if (!color) return { kind: "unknown" };
  return color.a === 0 ? { kind: "none" } : { kind: "value", value: color };
}

/** Effective background behind an element: the nearest solid paint in
 *  the ancestor chain, alpha-composited down to the white canvas.
 *  "unknown" when paint between the text and the canvas cannot be
 *  resolved (image, gradient, unresolved value). */
function effectiveBackground(
  chain: P5Node[],
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  scopes: Array<Map<string, string>>,
): Resolved<Rgba> {
  const layers: Rgba[] = [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const own = ownBackground(chain[i], rules, inlineStyles, scopes[i]);
    if (own.kind === "unknown") return { kind: "unknown" };
    if (own.kind === "value") {
      layers.push(own.value);
      if (own.value.a >= 1) break;
    }
  }
  let result: Rgba = { r: 255, g: 255, b: 255, a: 1 }; // the default canvas
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    result = compositeOver(layers[i], result);
  }
  return { kind: "value", value: result };
}

/** True when the element or an ancestor deliberately hides it. */
function isDeliberatelyHidden(
  chain: P5Node[],
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  scope: Map<string, string>,
): boolean {
  for (const el of chain) {
    if (attrOf(el, "hidden") !== null) return true;
    const display = winningDeclaration(el, rules, inlineStyles, "display");
    if (display) {
      const resolved = resolveVars(display.value, scope);
      if (resolved && resolved.trim().toLowerCase() === "none") return true;
    }
    const visibility = winningDeclaration(el, rules, inlineStyles, "visibility");
    if (visibility) {
      const resolved = resolveVars(visibility.value, scope);
      const v = resolved?.trim().toLowerCase();
      if (v === "hidden" || v === "collapse") return true;
    }
    const opacity = winningDeclaration(el, rules, inlineStyles, "opacity");
    if (opacity) {
      const resolved = resolveVars(opacity.value, scope);
      if (resolved && Number.parseFloat(resolved) === 0) return true;
    }
  }
  return false;
}

function describeElement(el: P5Node): string {
  const tag = (el.tagName ?? "element").toLowerCase();
  const id = attrOf(el, "id");
  const classes = classListOf(el);
  return tag + (id ? `#${id}` : "") + (classes.length > 0 ? `.${classes.join(".")}` : "");
}

function directText(el: P5Node): string {
  let text = "";
  for (const child of el.childNodes ?? []) {
    if (child.nodeName === "#text") text += child.value ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
}

export interface DocumentContrastResult {
  violations: Array<Omit<ContrastViolation, "path">>;
  /** False when the document's colors may be decided outside the
   *  document itself (linked local stylesheet, @import, an opaque
   *  at-rule) and nothing in it can be judged responsibly. */
  reasoned: boolean;
  /** Set when reasoned is false BECAUSE the document's colors are
   *  decided by the Tailwind browser runtime in shapes the narrow
   *  judgment cannot soundly model (ACC-03). Such a document is
   *  UNVERIFIABLE — never clean. Other unreasoned causes leave this
   *  unset, keeping their long-standing unenforced behavior. */
  unreasonedReason?: "tailwind-runtime";
}

/**
 * Find clear invisible-text violations in one HTML document, judging
 * only what the document itself declares. Pure and synchronous.
 */
export function findContrastViolations(html: string): DocumentContrastResult {
  if (typeof html !== "string" || !html.trim()) return { violations: [], reasoned: false };

  let doc: P5Node;
  try {
    doc = parse(html) as unknown as P5Node;
  } catch {
    return { violations: [], reasoned: false };
  }

  // Collect the document's own styles and detect colors that may be
  // decided elsewhere.
  const styleTexts: string[] = [];
  const tailwindTexts: string[] = [];
  let externalColorsPossible = false;
  let tailwindRuntime = false;
  const scan = (node: P5Node) => {
    for (const child of node.childNodes ?? []) {
      const tag = (child.tagName ?? "").toLowerCase();
      if (tag === "style") {
        // A text/tailwindcss block is source for the Tailwind browser
        // runtime, not plain CSS: the runtime compiles it (and the
        // utility classes in the markup) into CSS this checker never
        // sees. ACC-03: the block's text is kept for the narrow
        // runtime judgment below instead of bailing on sight.
        if ((attrOf(child, "type") ?? "").trim().toLowerCase() === "text/tailwindcss") {
          tailwindRuntime = true;
          tailwindTexts.push(directText(child));
        } else {
          styleTexts.push(directText(child));
        }
      } else if (tag === "script") {
        // The Tailwind browser build (Play CDN, or the v4 browser
        // package) generates the document's color CSS at runtime
        // from utility classes — again, CSS this checker cannot see.
        const src = attrOf(child, "src") ?? "";
        if (/tailwindcss/i.test(src)) tailwindRuntime = true;
      } else if (tag === "link") {
        const rel = (attrOf(child, "rel") ?? "").toLowerCase();
        if (rel.split(/\s+/).includes("stylesheet")) {
          const href = attrOf(child, "href") ?? "";
          // Font services serve @font-face only — never element
          // colors. Any other stylesheet (local file, theme CDN) may
          // carry the document's colors, so the document is beyond
          // this checker.
          if (!/^https?:\/\/fonts\.(googleapis|gstatic)\.com\//i.test(href)) {
            externalColorsPossible = true;
          }
        }
      }
      scan(child);
    }
  };
  scan(doc);

  const allCss = styleTexts.join("\n");
  if (externalColorsPossible || /@import/i.test(allCss)) {
    return { violations: [], reasoned: false };
  }

  const { rules, opaque } = parseStylesheet(allCss);
  if (opaque) return { violations: [], reasoned: false };

  // ACC-03: when the Tailwind runtime is present it can recolor any
  // element whose ancestor chain carries color utilities or a
  // modeled @apply class, and root-level runtime colors or
  // unmodelable @apply shapes can recolor anything at all.
  // Plain-cascade verdicts stay trustworthy only for elements the
  // runtime cannot recolor; the rest are decided after the visit
  // (narrow judgment or unverifiable), never by the plain cascade
  // alone.
  const tailwindModel = tailwindRuntime ? parseTailwindTheme(tailwindTexts) : null;
  const runtimeRootColors =
    tailwindModel !== null &&
    (tailwindModel.root.bg.kind !== "none" || tailwindModel.root.color.kind !== "none");
  const applyColorTokensPresent =
    tailwindModel !== null && (tailwindModel.unmodelable || runtimeRootColors);
  let anyRuntimeAffectedText = false;

  const inlineStyles = new Map<P5Node, Map<string, CssDeclaration>>();
  const violations: Array<Omit<ContrastViolation, "path"> & { runtimeAffected?: boolean }> = [];
  const seen = new Set<string>();

  const visit = (el: P5Node) => {
    if (violations.length >= MAX_VIOLATIONS_PER_FILE) return;
    const tag = (el.tagName ?? "").toLowerCase();
    if (SKIP_SUBTREE_TAGS.has(tag)) return;

    const styleAttr = attrOf(el, "style");
    if (styleAttr) inlineStyles.set(el, parseDeclarations(styleAttr, { next: 0 }));

    const text = directText(el);
    if (text.length >= 2 && /[A-Za-z0-9]/.test(text) && !SKIP_ELEMENT_TAGS.has(tag)) {
      const chain = ancestorChain(el);
      // ACC-03: can the Tailwind runtime recolor this element (a
      // color utility on it or an ancestor)? Tracked for every text
      // element, judged or not — it decides whose verdict counts.
      const chainRuntimeAffected =
        tailwindModel !== null &&
        chain.some((n) =>
          classListOf(n).some(
            (tok) => isColorUtilityToken(tok) || tailwindModel.classWriters.has(tok),
          ),
        );
      if (chainRuntimeAffected) anyRuntimeAffectedText = true;
      // One custom-property scope per chain prefix: scopes[i] is the
      // scope in force AT chain[i], so an ancestor's declarations
      // resolve with its own variables, not the target's.
      const scopes = chain.map((_, idx) =>
        customPropertyScope(chain.slice(0, idx + 1), rules, inlineStyles),
      );
      const scope = scopes[scopes.length - 1];
      if (!isDeliberatelyHidden(chain, rules, inlineStyles, scope)) {
        // Gradient-clipped text wears its background as its fill —
        // its declared color (usually transparent) is not its
        // rendered color, so it cannot be judged here.
        const clip = winningDeclaration(el, rules, inlineStyles, "background-clip")
          ?? winningDeclaration(el, rules, inlineStyles, "-webkit-background-clip");
        const clipValue = clip ? resolveVars(clip.value, scope)?.trim().toLowerCase() : null;
        if (clipValue !== "text") {
          const fg = effectiveTextColor(chain, rules, inlineStyles, scopes);
          if (fg.kind === "value" && fg.value.a > 0) {
            const bg = effectiveBackground(chain, rules, inlineStyles, scopes);
            if (bg.kind === "value") {
              const painted = fg.value.a >= 1 ? fg.value : compositeOver(fg.value, bg.value);
              const ratio = contrastRatio(painted, bg.value);
              if (ratio < INVISIBLE_RATIO) {
                const element = describeElement(el);
                const key = `${element}|${toHex(painted)}|${toHex(bg.value)}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  violations.push({
                    element,
                    text: text.length > 60 ? `${text.slice(0, 57)}...` : text,
                    color: toHex(painted),
                    background: toHex(bg.value),
                    ratio: Math.round(ratio * 100) / 100,
                    runtimeAffected: chainRuntimeAffected,
                  });
                }
              }
            }
          }
        }
      }
    }

    for (const child of el.childNodes ?? []) {
      if (child.tagName) visit(child);
    }
  };

  for (const child of doc.childNodes ?? []) {
    if (child.tagName) visit(child);
  }

  if (!tailwindRuntime) {
    return {
      violations: violations.map(({ runtimeAffected: _flag, ...v }) => v),
      reasoned: true,
    };
  }

  // ACC-03 resolution for Tailwind-runtime documents. Plain verdicts
  // count only where the runtime cannot recolor (no @apply color
  // tokens anywhere, and this element's chain carries no color
  // utility). Everything else goes to the narrow runtime judgment;
  // what it cannot soundly judge is UNVERIFIABLE, never clean.
  const trustworthy = applyColorTokensPresent
    ? []
    : violations
        .filter((v) => !v.runtimeAffected)
        .map(({ runtimeAffected: _flag, ...v }) => v);
  if (trustworthy.length > 0) return { violations: trustworthy, reasoned: true };
  if (!applyColorTokensPresent && !anyRuntimeAffectedText) {
    // The runtime is loaded but decides no color at stake — every
    // text element was judged on the document's own plain CSS.
    return { violations: [], reasoned: true };
  }
  const narrow = tailwindModel
    ? judgeTailwindRuntimeColors(doc, tailwindModel, rules, inlineStyles)
    : null;
  if (narrow === null) {
    return { violations: [], reasoned: false, unreasonedReason: "tailwind-runtime" };
  }
  return { violations: narrow, reasoned: true };
}

// ─── ACC-03: the narrow Tailwind-runtime judgment ────────────────────
//
// Deliberately NOT a Tailwind interpreter. It models exactly the
// shapes whose compiled colors are certain, composing them with the
// document's plain cascade (a plain <style> color still applies
// alongside compiled utilities — the runtime adds CSS, it does not
// replace the document's own):
//
//   - @theme custom properties (the tokens utilities resolve
//     through);
//   - the html/body rules of the text/tailwindcss block — plain
//     declarations and @apply tokens — which set the page's base
//     colors;
//   - rules whose selectors are ALL single classes (.glass-card),
//     modeled as per-class color writers;
//   - color utilities on elements and their ancestors, restricted
//     to a CLOSED token set: white, black, transparent, #hex, and
//     var() references that resolve through @theme.
//
// Two evidence-backed rules do the heavy lifting:
//
//   - bg-[--x] / text-[--x] (the Tailwind v3 variable shorthand)
//     compiles under the v4 browser build to a declaration browsers
//     drop as invalid (`background-color: --color-background`), so
//     the token has NO effect — proven against @tailwindcss/
//     browser@4 with the Run 1 evidence file: the same page with
//     bg-(--color-background) computes body background rgb(3,5,10);
//     with bg-[--color-background] it computes transparent while
//     the white text color applies. That asymmetry IS the blank
//     published page.
//   - Anything outside the model (palette shades like bg-zinc-900,
//     gradients, images, currentColor, unresolved variables,
//     conditional at-rule blocks, @apply colors on selectors that
//     are neither root nor single-class) makes the document
//     UNVERIFIABLE rather than guessed at.

type UtilityColor =
  | { kind: "color"; color: Rgba }
  | { kind: "dropped" }
  | { kind: "unknown" };

/** True when a class token has the shape of a COLOR utility (as
 *  opposed to typography/layout tokens like text-lg or bg-cover,
 *  which decide no color and are ignored). */
function isColorUtilityToken(token: string): boolean {
  const m = /^(?:bg|text)-(.+)$/.exec(token);
  if (!m) return false;
  const body = m[1].replace(/\/\d{1,3}$/, "");
  return (
    body === "white" ||
    body === "black" ||
    body === "transparent" ||
    body === "current" ||
    body === "currentcolor" ||
    body.startsWith("[") ||
    body.startsWith("(") ||
    body.startsWith("gradient-") ||
    /^#(?:[0-9a-f]{3,8})$/i.test(body) ||
    /^[a-z]+-[0-9]{2,3}$/.test(body)
  );
}

/** Classify one color-utility token against the @theme variables. */
function classifyUtilityColor(token: string, themeVars: Map<string, string>): UtilityColor {
  const m = /^(?:bg|text)-(.+)$/.exec(token);
  if (!m) return { kind: "unknown" };
  let body = m[1];
  let alpha = 1;
  const slash = /\/(\d{1,3})$/.exec(body);
  if (slash) {
    alpha = Math.min(1, Number(slash[1]) / 100);
    body = body.slice(0, slash.index);
  }
  const withAlpha = (color: Rgba): UtilityColor => ({
    kind: "color",
    color: { ...color, a: color.a * alpha },
  });
  if (body === "white") return withAlpha({ r: 255, g: 255, b: 255, a: 1 });
  if (body === "black") return withAlpha({ r: 0, g: 0, b: 0, a: 1 });
  if (body === "transparent") return { kind: "color", color: { r: 0, g: 0, b: 0, a: 0 } };
  // The v3 variable shorthand: compiles to an invalid declaration
  // the browser drops — the token does nothing at all.
  if (body.startsWith("[--") && body.endsWith("]")) return { kind: "dropped" };
  if (body.startsWith("[") && body.endsWith("]")) {
    const resolved = resolveVars(body.slice(1, -1), themeVars);
    if (resolved === null) return { kind: "unknown" };
    const color = parseCssColor(resolved);
    return color ? withAlpha(color) : { kind: "unknown" };
  }
  if (body.startsWith("(") && body.endsWith(")")) {
    const raw = themeVars.get(body.slice(1, -1).trim());
    if (raw === undefined) return { kind: "unknown" };
    const resolved = resolveVars(raw, themeVars);
    if (resolved === null) return { kind: "unknown" };
    const color = parseCssColor(resolved);
    return color ? withAlpha(color) : { kind: "unknown" };
  }
  if (/^#(?:[0-9a-f]{3,8})$/i.test(body)) {
    const color = parseCssColor(body);
    return color ? withAlpha(color) : { kind: "unknown" };
  }
  // Palette shades, gradients, currentColor, anything unrecognized:
  // a real color the narrow judgment will not guess.
  return { kind: "unknown" };
}

/** One property's runtime writer state after folding a rule's
 *  declarations in source order: the last writer wins, a dropped
 *  v3-shorthand token writes nothing, an unrecognized writer leaves
 *  the property honestly unknown. */
type ColorWriter =
  | { kind: "color"; color: Rgba }
  | { kind: "unknown" }
  | { kind: "none" };

interface TailwindColorWriters {
  bg: ColorWriter;
  color: ColorWriter;
}

interface TailwindThemeModel {
  themeVars: Map<string, string>;
  /** Writers from the html/body rules — the page's base colors. */
  root: TailwindColorWriters;
  /** Writers from rules whose selectors are all single classes. */
  classWriters: Map<string, TailwindColorWriters>;
  /** True when the block shapes exceed the narrow model entirely
   *  (conditional at-rules, @apply colors on unmodelable
   *  selectors): nothing in the document can be judged. */
  unmodelable: boolean;
}

function emptyWriters(): TailwindColorWriters {
  return { bg: { kind: "none" }, color: { kind: "none" } };
}

function foldUtilityToken(
  w: TailwindColorWriters,
  token: string,
  themeVars: Map<string, string>,
): void {
  if (!isColorUtilityToken(token)) return;
  const c = classifyUtilityColor(token, themeVars);
  if (c.kind === "dropped") return;
  const next: ColorWriter =
    c.kind === "color" ? { kind: "color", color: c.color } : { kind: "unknown" };
  if (token.startsWith("bg-")) w.bg = next;
  else w.color = next;
}

function foldPlainDeclaration(
  w: TailwindColorWriters,
  prop: "background" | "color",
  rawValue: string,
  themeVars: Map<string, string>,
): void {
  const set = (next: ColorWriter) => {
    if (prop === "background") w.bg = next;
    else w.color = next;
  };
  const resolved = resolveVars(rawValue, themeVars);
  if (resolved === null) {
    set({ kind: "unknown" });
    return;
  }
  const value = resolved.trim();
  const color = parseCssColor(value);
  if (color) {
    set({ kind: "color", color });
    return;
  }
  if (/gradient|url\(/i.test(value)) {
    set({ kind: "unknown" });
    return;
  }
  if (prop === "background") {
    // A background shorthand can carry a color among other parts.
    for (const part of value.split(/\s+/)) {
      const partColor = parseCssColor(part);
      if (partColor) {
        set({ kind: "color", color: partColor });
        return;
      }
    }
  }
  set({ kind: "unknown" });
}

/** Fold one rule body (plain declarations and @apply statements,
 *  interleaved in source order) into a writers record. */
function foldRuleBody(
  w: TailwindColorWriters,
  ruleBody: string,
  themeVars: Map<string, string>,
): void {
  const segmentRe = /@apply\s+([^;]+);?|([^@;]+);?/g;
  let sm: RegExpExecArray | null;
  while ((sm = segmentRe.exec(ruleBody)) !== null) {
    if (sm[1] !== undefined) {
      for (const tok of sm[1].split(/\s+/)) {
        if (tok) foldUtilityToken(w, tok, themeVars);
      }
    } else if (sm[2] !== undefined) {
      const colon = sm[2].indexOf(":");
      if (colon < 0) continue;
      const prop = sm[2].slice(0, colon).trim().toLowerCase();
      const value = sm[2].slice(colon + 1).trim();
      if (prop === "background" || prop === "background-color") {
        foldPlainDeclaration(w, "background", value, themeVars);
      } else if (prop === "color") {
        foldPlainDeclaration(w, "color", value, themeVars);
      }
    }
  }
}

function ruleHasColorContent(ruleBody: string): boolean {
  if (/@apply\s+[^;]*\b(?:bg|text)-/.test(ruleBody)) return true;
  return /(?:^|;)\s*(?:background|background-color|color)\s*:/.test(ruleBody);
}

/** Parse the text/tailwindcss blocks into the narrow theme model. */
function parseTailwindTheme(tailwindTexts: string[]): TailwindThemeModel {
  const css = tailwindTexts.join("\n");
  const themeVars = new Map<string, string>();
  const themeRe = /@theme\b[^{]*\{([^}]*)\}/g;
  let tm: RegExpExecArray | null;
  while ((tm = themeRe.exec(css)) !== null) {
    for (const decl of tm[1].split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      const name = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (name.startsWith("--") && value) themeVars.set(name, value);
    }
  }

  const model: TailwindThemeModel = {
    themeVars,
    root: emptyWriters(),
    classWriters: new Map(),
    unmodelable: false,
  };

  const withoutTheme = css.replace(/@theme\b[^{]*\{[^}]*\}/g, "");
  // Conditional at-rule blocks can restyle anything per environment
  // — beyond the narrow model.
  if (/@(?:media|supports|layer|keyframes|font-face|import|container)\b/.test(withoutTheme)) {
    model.unmodelable = true;
    return model;
  }

  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rm: RegExpExecArray | null;
  while ((rm = ruleRe.exec(withoutTheme)) !== null) {
    if (!ruleHasColorContent(rm[2])) continue;
    const selectors = rm[1].split(",").map((s) => s.trim().toLowerCase());
    const isRootSelector = (s: string) =>
      s === "body" || s === "html" || s === ":root" || s === "html body";
    if (selectors.every(isRootSelector)) {
      foldRuleBody(model.root, rm[2], themeVars);
      continue;
    }
    const classNames = selectors.map((s) => /^\.([a-z0-9_-]+)$/.exec(s)?.[1] ?? null);
    if (classNames.every((c): c is string => c !== null)) {
      for (const name of classNames) {
        let w = model.classWriters.get(name);
        if (!w) {
          w = emptyWriters();
          model.classWriters.set(name, w);
        }
        foldRuleBody(w, rm[2], themeVars);
      }
      continue;
    }
    // Color content on a selector shape the model does not cover
    // (descendant, element, pseudo, mixed): it can recolor anything
    // beneath it — the document is beyond judgment.
    model.unmodelable = true;
  }
  return model;
}

/**
 * Judge a Tailwind-runtime document's text visibility on the colors
 * the runtime will actually produce, composed with the document's
 * plain cascade — or return null when the shape is beyond the
 * narrow model (the caller then reports the document unverifiable).
 */
function judgeTailwindRuntimeColors(
  doc: P5Node,
  model: TailwindThemeModel,
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
): Array<Omit<ContrastViolation, "path">> | null {
  if (model.unmodelable) return null;
  if (model.root.bg.kind === "unknown" || model.root.color.kind === "unknown") return null;

  const violations: Array<Omit<ContrastViolation, "path">> = [];
  const seen = new Set<string>();
  let unjudgeable = false;

  const visitEl = (el: P5Node) => {
    if (unjudgeable || violations.length >= MAX_VIOLATIONS_PER_FILE) return;
    const tag = (el.tagName ?? "").toLowerCase();
    if (SKIP_SUBTREE_TAGS.has(tag)) return;

    // The plain visit may have stopped early at its violation cap;
    // make sure this element's inline style is on record either way.
    const styleAttr = attrOf(el, "style");
    if (styleAttr && !inlineStyles.has(el)) {
      inlineStyles.set(el, parseDeclarations(styleAttr, { next: 0 }));
    }

    const text = directText(el);
    if (text.length >= 2 && /[A-Za-z0-9]/.test(text) && !SKIP_ELEMENT_TAGS.has(tag)) {
      const chain = ancestorChain(el);
      const scopes = chain.map((_, idx) =>
        customPropertyScope(chain.slice(0, idx + 1), rules, inlineStyles),
      );
      const scope = scopes[scopes.length - 1];
      if (!isDeliberatelyHidden(chain, rules, inlineStyles, scope)) {
        // Runtime writers along the chain, root first: the root
        // rule seeds the base; each element's modeled class writers
        // apply, then its own utilities (the utilities layer wins
        // over @apply'd component classes in v4's cascade). Text
        // color is a single inherited value — last writer wins.
        // Backgrounds PAINT in layers: keep the runtime layers as a
        // composited stack (a translucent card background composites
        // over the root background beneath it, not over the canvas).
        let fgWriter: ColorWriter = model.root.color;
        let bgRuntime: Rgba | null = null;
        let bgUnknown = false;
        const foldBgWriter = (current: Rgba | null, w: ColorWriter): Rgba | null => {
          if (w.kind !== "color" || w.color.a <= 0) return current;
          if (w.color.a >= 1) return w.color;
          return current ? compositeOver(w.color, current) : w.color;
        };
        if (model.root.bg.kind === "unknown") bgUnknown = true;
        bgRuntime = foldBgWriter(bgRuntime, model.root.bg);
        for (const node of chain) {
          for (const cls of classListOf(node)) {
            const w = model.classWriters.get(cls);
            if (w) {
              if (w.color.kind !== "none") fgWriter = w.color;
              if (w.bg.kind === "unknown") bgUnknown = true;
              bgRuntime = foldBgWriter(bgRuntime, w.bg);
            }
          }
          for (const tok of classListOf(node)) {
            if (!isColorUtilityToken(tok)) continue;
            const c = classifyUtilityColor(tok, model.themeVars);
            if (c.kind === "dropped") continue;
            const next: ColorWriter =
              c.kind === "color" ? { kind: "color", color: c.color } : { kind: "unknown" };
            if (tok.startsWith("bg-")) {
              if (next.kind === "unknown") bgUnknown = true;
              bgRuntime = foldBgWriter(bgRuntime, next);
            } else {
              fgWriter = next;
            }
          }
        }
        if (fgWriter.kind === "unknown" || bgUnknown) {
          unjudgeable = true;
          return;
        }

        // Compose with the plain cascade: a property no runtime
        // writer claims keeps its plain-cascade value; a runtime
        // background stack composites over the plain result (the
        // contract shapes never interleave the two systems at
        // different depths — where they could, this errs toward the
        // runtime theme the document leads with).
        const plainFg = effectiveTextColor(chain, rules, inlineStyles, scopes);
        const plainBg = effectiveBackground(chain, rules, inlineStyles, scopes);
        let fg: Rgba | null = null;
        if (fgWriter.kind === "color") fg = fgWriter.color;
        else if (plainFg.kind === "value") fg = plainFg.value;
        let bg: Rgba | null = null;
        if (bgRuntime !== null && bgRuntime.a >= 1) {
          bg = bgRuntime;
        } else if (plainBg.kind === "value") {
          bg = bgRuntime !== null ? compositeOver(bgRuntime, plainBg.value) : plainBg.value;
        } else if (bgRuntime !== null) {
          bg = compositeOver(bgRuntime, { r: 255, g: 255, b: 255, a: 1 });
        }
        // plainBg unknown with no runtime background: the paint
        // behind the text cannot be resolved — skip the element.
        // fg unresolved (plain cascade could not resolve it) or bg
        // unknown: the plain path skips such elements, and so does
        // this judgment — skipped, never failed.
        if (fg !== null && bg !== null && fg.a > 0) {
          const painted = fg.a >= 1 ? fg : compositeOver(fg, bg);
          const ratio = contrastRatio(painted, bg);
          if (ratio < INVISIBLE_RATIO) {
            const element = describeElement(el);
            const key = `${element}|${toHex(painted)}|${toHex(bg)}`;
            if (!seen.has(key)) {
              seen.add(key);
              violations.push({
                element,
                text: text.length > 60 ? `${text.slice(0, 57)}...` : text,
                color: toHex(painted),
                background: toHex(bg),
                ratio: Math.round(ratio * 100) / 100,
              });
            }
          }
        }
      }
    }

    for (const child of el.childNodes ?? []) {
      if (child.tagName) visitEl(child);
    }
  };

  for (const child of doc.childNodes ?? []) {
    if (child.tagName) visitEl(child);
  }
  return unjudgeable ? null : violations;
}

function isHtmlFilePath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

/**
 * Read back the run's mutated HTML files and check each one for
 * invisible text. Mirrors checkRequestedLiteral's evidence rules:
 * unreadable files are skipped, and a candidate set truncated by the
 * read-back cap makes a clean result "unknown" rather than proven.
 */
export async function checkTextContrast(opts: {
  candidatePaths: ReadonlyArray<string>;
  readFile: (path: string) => Promise<{ content: string }>;
}): Promise<TextContrastCheck> {
  const allCandidates = [
    ...new Set(
      opts.candidatePaths
        .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
        .filter((p) => p.length > 0 && isHtmlFilePath(p)),
    ),
  ];
  if (allCandidates.length === 0) {
    return { applies: false, violations: [], checkedFiles: [], unverifiableFiles: [] };
  }
  const truncated = allCandidates.length > MAX_CHECKED_FILES;
  const candidates = allCandidates.slice(0, MAX_CHECKED_FILES);

  const checkedFiles: string[] = [];
  const violations: ContrastViolation[] = [];
  const unverifiableFiles: string[] = [];
  for (const path of candidates) {
    try {
      const { content } = await opts.readFile(path);
      if (typeof content !== "string") continue;
      checkedFiles.push(path);
      const result = findContrastViolations(content);
      for (const v of result.violations) violations.push({ path, ...v });
      if (!result.reasoned && result.unreasonedReason === "tailwind-runtime") {
        unverifiableFiles.push(path);
      }
    } catch {
      // Not readable — not checked. Other candidates may still answer.
    }
  }

  return {
    applies:
      checkedFiles.length > 0 &&
      (violations.length > 0 || unverifiableFiles.length > 0 || !truncated),
    violations,
    checkedFiles,
    unverifiableFiles,
  };
}

/** The honest user-facing sentence for a page that shipped invisible text. */
export function textContrastFailureMessage(violations: ContrastViolation[]): string {
  const first = violations[0];
  if (!first) return "I wrote the page, but some of its text would be invisible, so I can't confirm it landed as intended. Please try again.";
  const more = violations.length > 1 ? ` (and ${violations.length - 1} more like it)` : "";
  return (
    `I wrote the page, but some of its text would be invisible — "${first.text}" in ${first.path} ` +
    `is ${first.color} text on a ${first.background} background${more}. ` +
    `Words a visitor cannot read are not a finished page, so I can't confirm this build landed as intended. ` +
    `Please try again.`
  );
}

/** The mid-loop feedback fed back for the ONE automatic repair attempt. */
export function textContrastRepairPrompt(violations: ContrastViolation[]): string {
  const lines = violations
    .slice(0, 5)
    .map(
      (v) =>
        `- ${v.path}: <${v.element}> "${v.text}" — text color ${v.color} on background ${v.background} (contrast ${v.ratio}:1)`,
    )
    .join("\n");
  return (
    `Verification failed: some text in the page you just wrote would be INVISIBLE — ` +
    `its declared text color has almost no contrast with the background declared behind it:\n${lines}\n` +
    `This is the light-text-on-light-background failure: the CSS was written for a dark theme, ` +
    `but the dark background was never actually declared in the document (or the text colors were ` +
    `written for a background the document does not have). Fix the file now: either declare the dark ` +
    `background the design intends — on body or on the section behind the text — or change the text ` +
    `colors so every text element contrasts strongly with the background actually declared behind it. ` +
    `Then finish.`
  );
}

/** The honest user-facing sentence for a page whose visibility could
 *  not be verified at all (ACC-03) — distinct from a proven
 *  violation: nothing was proven invisible, but nothing was proven
 *  readable either, and an unverifiable page is not a finished page. */
export function textContrastUnverifiableMessage(files: string[]): string {
  const list = files.slice(0, 3).join(", ");
  return (
    `I wrote the page, but I can't verify that its text is visible — in ${list} the colors are decided ` +
    `at runtime by the Tailwind browser compiler instead of being declared in the document itself, ` +
    `so there is nothing in the file I can check the words against. A page I cannot verify is not a ` +
    `finished page, so I can't confirm this build landed as intended. Please try again.`
  );
}

/** The mid-loop feedback for the ONE repair attempt when a page's
 *  colors are runtime-decided beyond judgment (ACC-03). The repair
 *  it asks for — plain-CSS body colors — is exactly the PLAIN-CSS
 *  FLOOR the styling contract now requires, and it makes the page
 *  verifiable by construction. */
export function textContrastUnverifiableRepairPrompt(files: string[]): string {
  const list = files.slice(0, 3).join(", ");
  return (
    `Verification could not judge whether the text in ${list} is visible: the page's colors are produced ` +
    `at runtime by the Tailwind browser compiler (utility classes / @apply rules) rather than declared as ` +
    `plain CSS in the document, and runtime-decided colors cannot be verified from the file — this is exactly ` +
    `how invisible text shipped before, when a background the compiler dropped left light text on a light page. ` +
    `Fix the file now: declare the body's background and text colors as plain CSS in a regular <style> block ` +
    `(e.g. <style>body { background-color: #03050a; color: #f5f5f4; }</style>), and do the same for any section ` +
    `whose background sits behind light text. Plain declared colors are what make the page verifiable. ` +
    `Then finish.`
  );
}
