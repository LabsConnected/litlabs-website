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
 *
 * ACC-07 (Acceptance Run 1 on c15099b4, 2026-11-25): three extensions
 * under Larry's ruling, each still bounded by the decidability rule
 * above — nothing is judged on evidence the document does not itself
 * supply:
 *
 *   - The bar is now WCAG AA: 4.5:1 for normal text, 3:1 for large
 *     text (>= 24px, or >= 18.66px at weight >= 700), replacing the
 *     old 2:1 "effectively vanishes" floor. Font size and weight are
 *     resolved through the same cascade (plus UA defaults for
 *     heading/bold elements and Tailwind size/weight utilities), so
 *     the large-text allowance is itself decidable evidence, never
 *     a guess. The Run 1 page's prices were 1.19:1 — invisible under
 *     any bar — but muted text between 2:1 and AA is now also
 *     reported, because Larry's rule is "fix unreadable content
 *     before reporting build success", and AA is the readability
 *     standard he named.
 *   - The Tailwind narrow judgment resolves var() references against
 *     the document's PLAIN-CSS custom properties as well as @theme:
 *     the Run 1 page defined --color-primary: #a8ff2f in a regular
 *     <style> :root block and used it via text-[var(--color-primary)].
 *     The browser resolves that variable from the plain cascade, so
 *     the color was always statically decidable — the judge simply
 *     never looked outside @theme, called the page unverifiable, and
 *     ACC-06a's pass-with-note let it ship. A variable defined in
 *     BOTH places with different values is genuinely ambiguous and
 *     stays unjudged.
 *   - Element opacity is composed into the painted colors: an
 *     ancestor's opacity: 0.5 halves the alpha of everything under
 *     it, text and background layers alike. An opacity declaration
 *     that cannot be resolved makes the element unjudgeable, never
 *     failed.
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
  /** The WCAG AA ratio this text had to meet (ACC-07): 4.5 for
   *  normal text, 3 for large text. */
  requiredRatio: number;
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

/** ACC-07: the verdict bar is WCAG AA — 4.5:1 for normal text,
 *  3:1 for large text. (The pre-ACC-07 floor was 2:1, "effectively
 *  vanishes"; Larry's ruling replaced it with the AA standard.) */
const AA_RATIO_NORMAL = 4.5;
const AA_RATIO_LARGE = 3.0;

// ─── Font metrics (ACC-07) ───────────────────────────────────────────
// The large-text allowance needs the element's computed font size and
// weight. Both resolve through the same cascade as colors: a winning
// declaration resolved in its own scope, inherited down the chain,
// with UA defaults for the elements browsers size/embolden by default.
// A declared value that cannot be resolved (an unresolvable var(), a
// clamp() the checker does not evaluate) falls back to the inherited
// value — an approximation, documented here, that never invents a
// LARGER size than the evidence supports for the element itself: the
// element's own UA default applies only when no node in its chain
// declares a size at all.

const UA_FONT_SIZE_EM: Record<string, number> = {
  h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67,
};
const UA_BOLD_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "th"]);
const FONT_SIZE_KEYWORDS: Record<string, number> = {
  "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18,
  "x-large": 24, "xx-large": 32, "xxx-large": 48,
};

function parseFontSizePx(raw: string, parentPx: number, rootPx: number): number | null {
  const value = raw.trim().toLowerCase();
  if (FONT_SIZE_KEYWORDS[value] !== undefined) return FONT_SIZE_KEYWORDS[value];
  const m = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case "px": return n;
    case "pt": return (n * 96) / 72;
    case "em": return n * parentPx;
    case "rem": return n * rootPx;
    case "%": return (n / 100) * parentPx;
    default: return null;
  }
}

interface FontMetrics {
  sizePx: number;
  weight: number;
}

/** Computed font size (px) and weight for the last element of the
 *  chain, from plain CSS alone. */
function plainFontMetrics(
  chain: P5Node[],
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  scopes: Array<Map<string, string>>,
): FontMetrics {
  // Size: compute top-down, each node's declared size resolving
  // against its parent's computed size.
  const sizes: number[] = [];
  let rootPx = 16;
  let anyDeclared = false;
  for (let i = 0; i < chain.length; i += 1) {
    const parentPx = i === 0 ? 16 : sizes[i - 1];
    const winner = winningDeclaration(chain[i], rules, inlineStyles, "font-size");
    let size = parentPx;
    if (winner) {
      const resolved = resolveVars(winner.value, scopes[i]);
      const keyword = resolved?.trim().toLowerCase();
      if (keyword === "initial") size = 16;
      else if (keyword && keyword !== "inherit" && keyword !== "unset") {
        const parsed = parseFontSizePx(keyword, parentPx, rootPx);
        if (parsed !== null) {
          size = parsed;
          anyDeclared = true;
        }
      } else if (keyword) anyDeclared = true;
    }
    sizes.push(size);
    if (i === 0) rootPx = size;
  }
  let sizePx = sizes[sizes.length - 1];
  const el = chain[chain.length - 1];
  if (!anyDeclared && el.tagName && UA_FONT_SIZE_EM[el.tagName] !== undefined) {
    const parentPx = chain.length > 1 ? sizes[sizes.length - 2] : 16;
    sizePx = UA_FONT_SIZE_EM[el.tagName] * parentPx;
  }
  // Weight: nearest declaration walking up; UA-bold elements embolden
  // their subtree when nothing declares a weight.
  let weight = 400;
  let weightDecided = false;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const winner = winningDeclaration(chain[i], rules, inlineStyles, "font-weight");
    if (winner) {
      const resolved = resolveVars(winner.value, scopes[i]);
      const keyword = resolved?.trim().toLowerCase() ?? "";
      if (/^\d+$/.test(keyword)) { weight = Number(keyword); weightDecided = true; break; }
      if (keyword === "bold" || keyword === "bolder") { weight = 700; weightDecided = true; break; }
      if (keyword === "normal" || keyword === "lighter") { weight = 400; weightDecided = true; break; }
      if (keyword === "inherit" || keyword === "unset") continue;
      // Unresolvable weight declaration: fall through to the
      // inherited/UA answer rather than guessing.
      continue;
    }
    const chainTag = chain[i].tagName;
    if (chainTag && UA_BOLD_TAGS.has(chainTag)) {
      weight = 700;
      weightDecided = true;
      break;
    }
  }
  void weightDecided;
  return { sizePx, weight };
}

const TW_TEXT_SIZES: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30,
  "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128,
};
const TW_FONT_WEIGHTS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
};

/** Font size/weight declared by Tailwind utilities on the element or
 *  its ancestors (nearest wins — utilities inherit like CSS). Only
 *  the parts actually found are returned. */
function tailwindFontMetrics(chain: P5Node[]): { sizePx?: number; weight?: number } {
  let sizePx: number | undefined;
  let weight: number | undefined;
  for (let i = chain.length - 1; i >= 0 && (sizePx === undefined || weight === undefined); i -= 1) {
    for (const cls of classListOf(chain[i])) {
      const token = stripVariantPrefixes(cls);
      if (sizePx === undefined) {
        const sizeToken = /^text-(.+)$/.exec(token);
        if (sizeToken) {
          const body = sizeToken[1];
          if (TW_TEXT_SIZES[body] !== undefined) sizePx = TW_TEXT_SIZES[body];
          else if (body.startsWith("[") && body.endsWith("]")) {
            const parsed = parseFontSizePx(body.slice(1, -1), 16, 16);
            if (parsed !== null) sizePx = parsed;
          }
        }
      }
      if (weight === undefined) {
        const weightToken = /^font-(.+)$/.exec(token);
        if (weightToken && TW_FONT_WEIGHTS[weightToken[1]] !== undefined) {
          weight = TW_FONT_WEIGHTS[weightToken[1]];
        }
      }
    }
  }
  return { sizePx, weight };
}

/** WCAG large text: >= 24px, or >= 18.66px (14pt) at weight >= 700. */
function isLargeText(metrics: FontMetrics): boolean {
  return metrics.sizePx >= 24 || (metrics.sizePx >= 18.66 && metrics.weight >= 700);
}

function requiredRatioFor(metrics: FontMetrics): number {
  return isLargeText(metrics) ? AA_RATIO_LARGE : AA_RATIO_NORMAL;
}

// ─── Opacity (ACC-07) ────────────────────────────────────────────────

/** Cumulative opacity at each node of the chain (the product of the
 *  node's own opacity and every ancestor's). Returns null when any
 *  DECLARED opacity cannot be resolved to a number — the element is
 *  then unjudgeable, never failed on a guess. */
function chainOpacity(
  chain: P5Node[],
  rules: CssRule[],
  inlineStyles: Map<P5Node, Map<string, CssDeclaration>>,
  scopes: Array<Map<string, string>>,
): number[] | null {
  const cumulative: number[] = [];
  let product = 1;
  for (let i = 0; i < chain.length; i += 1) {
    const winner = winningDeclaration(chain[i], rules, inlineStyles, "opacity");
    if (winner) {
      const resolved = resolveVars(winner.value, scopes[i]);
      if (resolved === null) return null;
      const keyword = resolved.trim().toLowerCase();
      if (keyword !== "inherit" && keyword !== "unset") {
        const parsed = keyword.endsWith("%")
          ? Number(keyword.slice(0, -1)) / 100
          : Number(keyword);
        if (!Number.isFinite(parsed)) return null;
        product *= Math.min(1, Math.max(0, parsed));
      }
    }
    cumulative.push(product);
  }
  return cumulative;
}

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
  // ACC-07: an ancestor's opacity composites the whole subtree, so
  // each background layer's painted alpha is scaled by the cumulative
  // opacity at the node that painted it. An unresolvable opacity
  // declaration makes the background unjudgeable, never guessed.
  const opacity = chainOpacity(chain, rules, inlineStyles, scopes);
  if (opacity === null) return { kind: "unknown" };
  const layers: Rgba[] = [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const own = ownBackground(chain[i], rules, inlineStyles, scopes[i]);
    if (own.kind === "unknown") return { kind: "unknown" };
    if (own.kind === "value") {
      const painted = { ...own.value, a: own.value.a * opacity[i] };
      layers.push(painted);
      if (painted.a >= 1) break;
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

/** ACC-07: the custom properties the document's PLAIN CSS puts in
 *  force at the root — the scope computed for the body element's
 *  ancestor chain (html → body), including those elements' inline
 *  styles. Utilities compiled by the Tailwind browser runtime
 *  resolve var() against these values at runtime, so the narrow
 *  judgment merges them into its variable scope. */
function plainRootVariableScope(doc: P5Node, rules: CssRule[]): Map<string, string> {
  let target: P5Node | null = null;
  const find = (node: P5Node, tag: string): P5Node | null => {
    for (const child of node.childNodes ?? []) {
      if ((child.tagName ?? "").toLowerCase() === tag) return child;
      const nested = find(child, tag);
      if (nested) return nested;
    }
    return null;
  };
  target = find(doc, "body") ?? find(doc, "html");
  if (!target) return new Map();
  const chain = ancestorChain(target);
  const inline = new Map<P5Node, Map<string, CssDeclaration>>();
  for (const node of chain) {
    const styleAttr = attrOf(node, "style");
    if (styleAttr) inline.set(node, parseDeclarations(styleAttr, { next: 0 }));
  }
  return customPropertyScope(chain, rules, inline);
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

  // ACC-07: the document's plain-CSS custom properties in force at
  // the root (the scope computed for the body element's chain). The
  // browser resolves a utility's var() against exactly these (plus
  // @theme, which the compiler emits to :root), so the narrow
  // runtime judgment resolves against them too.
  const plainRootVars = plainRootVariableScope(doc, rules);

  // ACC-03: when the Tailwind runtime is present it can recolor any
  // element whose ancestor chain carries color utilities or a
  // modeled @apply class, and root-level runtime colors or
  // unmodelable @apply shapes can recolor anything at all.
  // Plain-cascade verdicts stay trustworthy only for elements the
  // runtime cannot recolor; the rest are decided after the visit
  // (narrow judgment or unverifiable), never by the plain cascade
  // alone.
  const tailwindModel = tailwindRuntime ? parseTailwindTheme(tailwindTexts, plainRootVars) : null;
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
            (tok) =>
              isColorUtilityToken(tok, tailwindModel.themeVars) ||
              tailwindModel.classWriters.has(tok),
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
              // ACC-07: the element's painted alpha includes the
              // cumulative opacity of its chain (an unresolvable
              // opacity already made the background unknown above).
              const opacity = chainOpacity(chain, rules, inlineStyles, scopes);
              const paintedFg = opacity === null
                ? fg.value
                : { ...fg.value, a: fg.value.a * opacity[opacity.length - 1] };
              if (paintedFg.a > 0) {
                const painted = paintedFg.a >= 1 ? paintedFg : compositeOver(paintedFg, bg.value);
                const ratio = contrastRatio(painted, bg.value);
                const requiredRatio = requiredRatioFor(plainFontMetrics(chain, rules, inlineStyles, scopes));
                if (ratio < requiredRatio) {
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
                      requiredRatio,
                      runtimeAffected: chainRuntimeAffected,
                    });
                  }
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

/** Strip Tailwind variant prefixes (md:, lg:, hover:, dark:, …)
 *  from a class token, leaving the base utility. Stripping serves
 *  DETECTION: a prefixed color utility is still a color utility,
 *  so its chain is runtime-affected and the runtime judge decides
 *  it (Greptile, PR #1108). Whether a prefixed token may also
 *  WRITE the colors the default state is judged on is a separate
 *  question — see conditionalDisposition. Bracketed variant
 *  forms (data-[state=open]:, supports-[…]:) are stripped through
 *  their closing bracket. */
function stripVariantPrefixes(token: string): string {
  let t = token;
  while (!/^(?:bg|text)-/.test(t)) {
    const bracketed = t.indexOf("]:");
    if (bracketed >= 0 && t.startsWith("[") === false && /^[a-zA-Z][a-zA-Z0-9_-]*-\[/.test(t)) {
      t = t.slice(bracketed + 2);
      continue;
    }
    const m = /^([a-zA-Z0-9_-]+):/.exec(t);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  return t;
}

/** The variant prefixes on a class token, in order, using the
 *  same scan as stripVariantPrefixes: named segments (hover,
 *  md, group-hover, …) and bracketed forms kept whole
 *  (data-[state=open], min-[400px], …). */
function variantPrefixesOf(token: string): string[] {
  const prefixes: string[] = [];
  let t = token;
  while (!/^(?:bg|text)-/.test(t)) {
    const bracketed = t.indexOf("]:");
    if (bracketed >= 0 && t.startsWith("[") === false && /^[a-zA-Z][a-zA-Z0-9_-]*-\[/.test(t)) {
      prefixes.push(t.slice(0, bracketed + 1));
      t = t.slice(bracketed + 2);
      continue;
    }
    const m = /^([a-zA-Z0-9_-]+):/.exec(t);
    if (!m) break;
    prefixes.push(m[1]);
    t = t.slice(m[0].length);
  }
  return prefixes;
}

/** Environment variants: conditions of the page's environment
 *  (viewport, color scheme, orientation, direction, motion and
 *  contrast preferences, print) rather than of a transient
 *  interaction state. For a whole class of real visitors the
 *  condition holds full-time, so the previous round's rule —
 *  assume it holds and judge the color as applying — stands for
 *  these (Greptile, PR #1108). */
function isEnvironmentVariant(prefix: string): boolean {
  const p = prefix.toLowerCase();
  return (
    p === "sm" || p === "md" || p === "lg" || p === "xl" || p === "2xl" ||
    p.startsWith("min-") || p.startsWith("max-") ||
    p === "dark" ||
    p === "portrait" || p === "landscape" ||
    p === "ltr" || p === "rtl" ||
    p === "motion-safe" || p === "motion-reduce" ||
    p === "contrast-more" || p === "contrast-less" ||
    p === "forced-colors" ||
    p === "print"
  );
}

/** Interaction variants: conditions on a transient interaction
 *  or form state (hover, focus, active, visited, checked,
 *  disabled, group-*, peer-*, …). None of them hold in the state
 *  a visitor first sees the page in, so a color behind one
 *  paints nothing in the default state and can never be the
 *  color the default state is judged on (Greptile, PR #1108):
 *  hover:text-white on a black page leaves the unhovered text at
 *  its inherited default color — black on black — however white
 *  the hover state would be. group- and peer- conditions live on
 *  another element's interaction state, so they are interaction
 *  conditions too, not this element's. */
function isInteractionVariant(prefix: string): boolean {
  const p = prefix.toLowerCase();
  return (
    p === "hover" || p === "focus" || p === "focus-visible" || p === "focus-within" ||
    p === "active" || p === "visited" || p === "target" ||
    p === "checked" || p === "disabled" || p === "enabled" || p === "indeterminate" ||
    p === "read-only" || p === "required" ||
    p === "invalid" || p === "valid" || p === "user-valid" || p === "user-invalid" ||
    p === "placeholder-shown" || p === "autofilled" ||
    p === "in-range" || p === "out-of-range" ||
    p === "default" || p === "empty" || p === "open" || p === "inert" ||
    p.startsWith("group-") || p.startsWith("peer-")
  );
}

/** The structural variants this narrow model can DECIDE from
 *  the parsed document: conditions on the element's own position
 *  among its siblings. Unlike an interaction state, a structural
 *  condition can already hold when the page loads — a paragraph
 *  that IS the first child is painted by first:text-white in the
 *  default state, and dropping that color reported a genuinely
 *  readable page as black-on-black (Greptile, PR #1108). */
const STRUCTURAL_VARIANTS = new Set([
  "first",
  "last",
  "only",
  "first-of-type",
  "last-of-type",
  "only-of-type",
]);

/** The element children of el's parent, el included; an element
 *  with no reachable parent stands alone, trivially first, last
 *  and only. Text and comment nodes are not siblings for
 *  :first-child and kin — only elements count. */
function elementSiblings(el: P5Node): P5Node[] {
  const parent = el.parentNode;
  if (!parent || !parent.childNodes) return [el];
  const els = parent.childNodes.filter((c) => c.tagName);
  return els.length > 0 ? els : [el];
}

/** Whether a decidable structural variant holds for THIS
 *  element, from its actual position among its siblings
 *  (of-type = among siblings with the same tag name). */
function structuralVariantHolds(prefix: string, el: P5Node): boolean {
  const siblings = elementSiblings(el);
  switch (prefix.toLowerCase()) {
    case "first":
      return siblings[0] === el;
    case "last":
      return siblings[siblings.length - 1] === el;
    case "only":
      return siblings.length === 1;
    case "first-of-type": {
      const tag = (el.tagName ?? "").toLowerCase();
      return siblings.find((s) => (s.tagName ?? "").toLowerCase() === tag) === el;
    }
    case "last-of-type": {
      const tag = (el.tagName ?? "").toLowerCase();
      const ofType = siblings.filter((s) => (s.tagName ?? "").toLowerCase() === tag);
      return ofType[ofType.length - 1] === el;
    }
    case "only-of-type": {
      const tag = (el.tagName ?? "").toLowerCase();
      return siblings.filter((s) => (s.tagName ?? "").toLowerCase() === tag).length === 1;
    }
    default:
      return false;
  }
}

/** How a token's color stands in the DEFAULT state — the only
 *  state this check certifies:
 *
 *  - "applies": unconditional, environment-only (the previous
 *    rounds' rule: for a whole class of visitors the condition
 *    holds full-time), or behind decidable structural variants
 *    that all HOLD for the element being folded.
 *  - "absent": behind an interaction variant anywhere in the
 *    stack (md:hover:… paints nothing unhovered at any
 *    viewport), or behind decidable structural variants that do
 *    not hold for this element — the color genuinely does not
 *    paint it, so it contributes nothing.
 *  - "unknown": behind any other condition this narrow model
 *    does not decide — odd/even/nth-*, data-[…]:, aria-*:, and
 *    structural variants folded without an element to judge
 *    them against (@apply tokens in a rule body apply to
 *    elements whose positions the fold cannot see). Unknown is
 *    honest: the writer feeds the module's unverifiable path
 *    rather than being silently absent or silently present. */
type ConditionalDisposition = "applies" | "absent" | "unknown";

function conditionalDisposition(token: string, el?: P5Node): ConditionalDisposition {
  const prefixes = variantPrefixesOf(token);
  if (prefixes.length === 0) return "applies";
  if (prefixes.every(isEnvironmentVariant)) return "applies";
  if (prefixes.some(isInteractionVariant)) return "absent";
  const conditional = prefixes.filter((p) => !isEnvironmentVariant(p));
  if (conditional.every((p) => STRUCTURAL_VARIANTS.has(p.toLowerCase()))) {
    if (!el) return "unknown";
    return conditional.every((p) => structuralVariantHolds(p, el)) ? "applies" : "absent";
  }
  return "unknown";
}

/** True when a class token has the shape of a COLOR utility (as
 *  opposed to typography/layout tokens like text-lg or bg-cover,
 *  which decide no color and are ignored). Variant prefixes are
 *  stripped first. Theme-named colors (bg-background,
 *  text-foreground) count when the document's @theme defines the
 *  matching --color-* variable — in Tailwind v4 that definition is
 *  precisely what makes the utility exist. */
function isColorUtilityToken(token: string, themeVars?: Map<string, string>): boolean {
  const m = /^(?:bg|text)-(.+)$/.exec(stripVariantPrefixes(token));
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
    /^[a-z]+-[0-9]{2,3}$/.test(body) ||
    (themeVars !== undefined &&
      /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(body) &&
      themeVars.has(`--color-${body}`))
  );
}

/** Classify one color-utility token against the @theme variables. */
function classifyUtilityColor(token: string, themeVars: Map<string, string>): UtilityColor {
  const m = /^(?:bg|text)-(.+)$/.exec(stripVariantPrefixes(token));
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
  // Theme-named colors (Greptile, PR #1108): bg-background /
  // text-foreground resolve through the @theme variable of the
  // same name — --color-background, --color-foreground — exactly
  // like the bg-(--color-x) form above. A variable that exists but
  // does not resolve to a concrete color is unknown (the document
  // goes UNVERIFIABLE, never silently clean); a name with no
  // @theme definition generates no utility at all in v4 and falls
  // through to unknown as well when it reached classification via
  // a palette-shaped sibling — either way it is never guessed.
  if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(body)) {
    const raw = themeVars.get(`--color-${body}`);
    if (raw !== undefined) {
      const resolved = resolveVars(raw, themeVars);
      if (resolved === null) return { kind: "unknown" };
      const color = parseCssColor(resolved);
      return color ? withAlpha(color) : { kind: "unknown" };
    }
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
  el?: P5Node,
): void {
  if (!isColorUtilityToken(token, themeVars)) return;
  // Conditional colors are disposed of before they can write —
  // see conditionalDisposition. "absent" colors (interaction
  // states, structural conditions that do not hold for this
  // element) never write a default-state writer: the element is
  // judged on whatever its default state actually declares (its
  // own unprefixed utilities, class writers, plain CSS,
  // inheritance, the initial colors). "unknown" colors
  // (conditions the narrow model does not decide) write an
  // unknown writer instead: reached by the walk, the document is
  // unverifiable — never silently clean, never silently failed.
  const disposition = conditionalDisposition(token, el);
  if (disposition === "absent") return;
  if (disposition === "unknown") {
    const unknown: ColorWriter = { kind: "unknown" };
    if (stripVariantPrefixes(token).startsWith("bg-")) w.bg = unknown;
    else w.color = unknown;
    return;
  }
  const c = classifyUtilityColor(token, themeVars);
  if (c.kind === "dropped") return;
  const next: ColorWriter =
    c.kind === "color" ? { kind: "color", color: c.color } : { kind: "unknown" };
  if (stripVariantPrefixes(token).startsWith("bg-")) w.bg = next;
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
function parseTailwindTheme(
  tailwindTexts: string[],
  plainRootVars?: Map<string, string>,
): TailwindThemeModel {
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
  // ACC-07: merge the document's plain-CSS root variables — the
  // browser resolves var() in compiled utilities against them just
  // as it does against @theme's emitted :root declarations (Run 1 on
  // c15099b4 defined --color-primary in a plain <style> block only,
  // and the judge called the page unverifiable). A name defined in
  // both places with DIFFERENT values is genuinely ambiguous —
  // cascade order between the document's stylesheet and the
  // compiler's generated one decides it — so it is removed, leaving
  // references to it unresolvable and therefore unjudged.
  if (plainRootVars) {
    for (const [name, value] of plainRootVars) {
      const existing = themeVars.get(name);
      if (existing === undefined) themeVars.set(name, value);
      else if (existing !== value) themeVars.delete(name);
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
        // Compose runtime and plain colors BY PROXIMITY
        // (Greptile, PR #1108). The first version folded every
        // runtime writer in the chain into a single value that
        // overrode the plain cascade wholesale — so a body's
        // bg-black / text-white utilities hid a child section's own
        // plain background:white, and the white-on-white inside it
        // was missed. Now each chain node contributes its own
        // writers — the block's html/body rules (model.root) attach
        // at the body node, then the node's modeled class writers,
        // then its own utilities (the utilities layer wins over
        // @apply'd component classes in v4's cascade) — and the
        // NEAREST deciding node wins, exactly as paint and
        // inheritance behave:
        //
        //   - Text color is a single inherited value: walking from
        //     the element up, the first node carrying a runtime
        //     color writer or a plain color declaration decides it.
        //     At one node, an inline plain declaration outranks the
        //     node's runtime writer (inline styles beat utilities
        //     in the real cascade); any other same-node tie goes to
        //     the runtime, the theme the document leads with. The
        //     per-node plain step mirrors effectiveTextColor's
        //     semantics (inherit/unset climb, initial is black, an
        //     unresolvable value skips the element).
        //   - Backgrounds paint in layers: walking up, each node's
        //     layer is its runtime bg writer when it has one, else
        //     its plain paint (ownBackground); layers composite
        //     nearest-over-farther until the stack is opaque, then
        //     over the white canvas.
        //
        // An unknown RUNTIME writer (palette shade, unresolved
        // theme variable) makes the document unjudgeable only when
        // the walk actually reaches it — a nearer decider overrides
        // it exactly as the browser paints over it. An unknown
        // PLAIN paint (an image, a gradient) skips just the
        // element, as the plain path has always done — skipped,
        // never failed. Where the walk is decided by plain
        // declarations alone the verdict is the plain cascade's,
        // so plain authority is extended node by node, not
        // replaced.
        const rootAttachIdx = (() => {
          let idx = -1;
          for (let i = 0; i < chain.length; i += 1) {
            const t = (chain[i].tagName ?? "").toLowerCase();
            if (t === "body") return i;
            if (t === "html") idx = i;
          }
          return idx;
        })();
        const nodeWriters: TailwindColorWriters[] = chain.map((node, i) => {
          const w = emptyWriters();
          if (i === rootAttachIdx) {
            w.bg = model.root.bg;
            w.color = model.root.color;
          }
          for (const cls of classListOf(node)) {
            const cw = model.classWriters.get(cls);
            if (cw) {
              if (cw.color.kind !== "none") w.color = cw.color;
              if (cw.bg.kind !== "none") w.bg = cw.bg;
            }
          }
          for (const tok of classListOf(node)) foldUtilityToken(w, tok, model.themeVars, node);
          return w;
        });

        // Text color: nearest deciding node wins.
        let fg: Rgba | null = null;
        let fgUnknown = false;
        let fgSkipped = false;
        for (let i = chain.length - 1; i >= 0; i -= 1) {
          const winner = winningDeclaration(chain[i], rules, inlineStyles, "color");
          if (!winner || !winner.inline) {
            const rt = nodeWriters[i].color;
            if (rt.kind === "color") { fg = rt.color; break; }
            if (rt.kind === "unknown") { fgUnknown = true; break; }
          }
          if (!winner) continue;
          const resolved = resolveVars(winner.value, scopes[i]);
          if (resolved === null) { fgSkipped = true; break; }
          const keyword = resolved.trim().toLowerCase();
          if (keyword === "inherit" || keyword === "unset") continue;
          if (keyword === "initial") { fg = { r: 0, g: 0, b: 0, a: 1 }; break; }
          const color = parseCssColor(resolved);
          if (!color) { fgSkipped = true; break; }
          fg = color;
          break;
        }
        if (fgUnknown) {
          unjudgeable = true;
          return;
        }
        if (!fgSkipped && fg === null) fg = { r: 0, g: 0, b: 0, a: 1 };

        // ACC-07: cumulative opacity scales every painted layer,
        // runtime and plain alike. Unresolvable opacity leaves the
        // element unjudged (skipped), never guessed at.
        const opacity = chainOpacity(chain, rules, inlineStyles, scopes);
        let bgSkipped = false;
        if (opacity === null) {
          fgSkipped = true;
          bgSkipped = true;
        }

        // Background: per-node layers composited to opacity.
        let bgStack: Rgba | null = null;
        let bgUnknown = false;
        for (let i = chain.length - 1; i >= 0; i -= 1) {
          if (bgStack !== null && bgStack.a >= 1) break;
          const rt = nodeWriters[i].bg;
          let layer: Rgba | null = null;
          if (rt.kind === "unknown") { bgUnknown = true; break; }
          if (rt.kind === "color" && rt.color.a > 0) {
            layer = rt.color;
          } else {
            const own = ownBackground(chain[i], rules, inlineStyles, scopes[i]);
            if (own.kind === "unknown") { bgSkipped = true; break; }
            if (own.kind === "value") layer = own.value;
          }
          if (layer !== null) {
            const paintedLayer = opacity === null
              ? layer
              : { ...layer, a: layer.a * opacity[i] };
            bgStack = bgStack === null ? paintedLayer : compositeOver(bgStack, paintedLayer);
          }
        }
        if (bgUnknown) {
          unjudgeable = true;
          return;
        }
        const bg: Rgba = bgStack === null
          ? { r: 255, g: 255, b: 255, a: 1 }
          : compositeOver(bgStack, { r: 255, g: 255, b: 255, a: 1 });

        if (!fgSkipped && !bgSkipped && fg !== null && fg.a > 0) {
          const paintedFg = opacity === null
            ? fg
            : { ...fg, a: fg.a * opacity[opacity.length - 1] };
          if (paintedFg.a > 0) {
            const painted = paintedFg.a >= 1 ? paintedFg : compositeOver(paintedFg, bg);
            const ratio = contrastRatio(painted, bg);
            // ACC-07: WCAG AA bar; size/weight come from utilities
            // where the runtime declares them, else the plain
            // cascade and UA defaults.
            const plainMetrics = plainFontMetrics(chain, rules, inlineStyles, scopes);
            const twMetrics = tailwindFontMetrics(chain);
            const requiredRatio = requiredRatioFor({
              sizePx: twMetrics.sizePx ?? plainMetrics.sizePx,
              weight: twMetrics.weight ?? plainMetrics.weight,
            });
            if (ratio < requiredRatio) {
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
                  requiredRatio,
                });
              }
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
    `is ${first.color} text on a ${first.background} background (contrast ${first.ratio}:1; ` +
    `readable text needs at least ${first.requiredRatio}:1)${more}. ` +
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
        `- ${v.path}: <${v.element}> "${v.text}" — text color ${v.color} on background ${v.background} (contrast ${v.ratio}:1, needs at least ${v.requiredRatio}:1)`,
    )
    .join("\n");
  return (
    `Verification failed: some text in the page you just wrote would be INVISIBLE — ` +
    `its declared text color does not meet the WCAG AA contrast bar against the background declared behind it:\n${lines}\n` +
    `This is the light-text-on-light-background failure: the CSS was written for a dark theme, ` +
    `but the dark background was never actually declared in the document (or the text colors were ` +
    `written for a background the document does not have). Fix the file now: either declare the dark ` +
    `background the design intends — on body or on the section behind the text — or change the text ` +
    `colors so every text element meets the required contrast against the background actually declared behind it. ` +
    `A bright accent color (a theme primary like a lime or yellow) must not carry small text — prices, ` +
    `captions, links, body copy — on a light background; use it for large headings or decoration, and ` +
    `give small text a color that passes. Then finish.`
  );
}

/** The honest user-facing sentence for a page whose visibility could
 *  not be verified at all (ACC-03) — distinct from a proven
 *  violation: nothing was proven invisible, but nothing was proven
 *  readable either, and an unverifiable page is not a finished page. */
/**
 * ACC-06a item 1 — the pass-with-note text for runtime-decided
 * colors. Larry's rule (Acceptance Run 1 on 8cd7728c, where this
 * shape FAILED a correctly rendered build): the verifier may only
 * fail a build on contrast evidence it can statically decide.
 * Colors the Tailwind browser compiler decides at runtime are
 * outside that evidence, so the run completes and this note rides
 * its closing text — the unverifiable scope is stated plainly,
 * never hidden and never dressed as a failure.
 */
export function textContrastUnverifiableNote(files: string[]): string {
  const list = files.slice(0, 3).join(", ");
  return (
    `Note: I couldn't statically verify the text contrast in ${list} — the colors there are decided ` +
    `at runtime by the Tailwind browser compiler instead of being declared in the document itself. ` +
    `The page was delivered exactly as written; if any text is hard to read, I can rewrite those ` +
    `colors in plain CSS so they can be checked.`
  );
}

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
