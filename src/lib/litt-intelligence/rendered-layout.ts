/**
 * Rendered-layout verification — ACC-08 Defect 2b (static judge).
 *
 * Acceptance Run 1 on ba16d435 shipped a generated site that rendered
 * in a ~230px centred column at desktop width — hero clipped, cards
 * overlapping — while looking correct at phone width. No stage judged
 * layout at all: the seven project checks are workspace commands and
 * the contrast verifier judges declared colors only.
 *
 * This module mirrors text-contrast.ts's shape (applies / violations /
 * unverifiableFiles + failure-message and repair-prompt builders) so
 * it plugs into the agent loop exactly where contrast does.
 *
 * HOSTING STATE: the full judge renders the page in headless Chromium
 * at 1440×900 and 390×844 and measures the laid-out boxes (content
 * width ratio, sibling overlap, overflow, clipping). No Chromium is
 * hosted in the production shell image or verified on the terminal
 * server yet, so that gate is designed but NOT wired — it lands when
 * the renderer-hosting decision is made (terminal-server exec channel
 * vs a pinned Chromium in the shell image).
 *
 * What ships now is the static heuristic the scope calls for: it
 * flags the exact failure shape from source — a page-level wrapper
 * whose declared max-width caps the page under ~40rem, or whose fixed
 * width is under ~600px. It judges only POSITIVE evidence (a declared
 * absolute cap on the wrapper chain that holds the page's content);
 * absence of a resolvable declaration is never a violation (F9's
 * rule), and section-level cards with narrow caps are not the page
 * collapsing, so they are not flagged.
 */

import { parse } from "parse5";

// ─── Public shapes ───────────────────────────────────────────────────

export interface LayoutViolation {
  /** Workspace-relative path of the HTML file. */
  path: string;
  /** Element descriptor, e.g. `div.page-wrap` or `main#content`. */
  element: string;
  /** The CSS property carrying the cap: "max-width" or "width". */
  property: "max-width" | "width";
  /** The declared value as written, e.g. "24rem" or "480px". */
  declared: string;
  /** The declared value converted to CSS pixels. */
  declaredPx: number;
  /** The minimum a page-level container may cap at, in CSS pixels. */
  thresholdPx: number;
}

export interface RenderedLayoutCheck {
  /** True when at least one mutated HTML file could be read back and
   *  the evidence is complete (same rule as the contrast check: a
   *  candidate set truncated by the read-back cap with no violation
   *  found is unknown, not clean). */
  applies: boolean;
  /** Proven desktop-collapse shapes found in the checked files. */
  violations: LayoutViolation[];
  /** Files actually read and checked. */
  checkedFiles: string[];
  /** Reserved for the headless-render gate: files whose layout only
   *  exists after runtime compilation and cannot be judged from
   *  source. The static judge never produces unverifiable files — it
   *  either proves a declared cap or stays silent. */
  unverifiableFiles: string[];
}

/** A page-level max-width below this (40rem) is a phone-width cap on
 *  the whole page — the Run 1 collapse shape. */
export const LAYOUT_MAX_WIDTH_FLOOR_PX = 640;
/** A page-level fixed width below this is a fixed narrow column. */
export const LAYOUT_FIXED_WIDTH_FLOOR_PX = 600;

const MAX_CHECKED_FILES = 8;

// ─── parse5 tree helpers ─────────────────────────────────────────────

interface P5Node {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
  value?: string;
  parentNode?: P5Node;
}

const NON_RENDERED_TAGS = new Set(["script", "style", "template", "noscript"]);

function attr(node: P5Node, name: string): string | null {
  const found = node.attrs?.find((a) => a.name === name);
  return found ? found.value : null;
}

function elementChildren(node: P5Node): P5Node[] {
  return (node.childNodes ?? []).filter((c) => typeof c.tagName === "string");
}

function findFirst(node: P5Node, tagName: string): P5Node | null {
  if (node.tagName === tagName) return node;
  for (const child of node.childNodes ?? []) {
    const found = findFirst(child, tagName);
    if (found) return found;
  }
  return null;
}

function collectText(node: P5Node, into: string[]): void {
  if (node.tagName && NON_RENDERED_TAGS.has(node.tagName)) return;
  if (node.nodeName === "#text") {
    into.push(node.value ?? "");
    return;
  }
  for (const child of node.childNodes ?? []) collectText(child, into);
}

function textLength(node: P5Node, cache: Map<P5Node, number>): number {
  const cached = cache.get(node);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  collectText(node, parts);
  const length = parts.join(" ").replace(/\s+/g, " ").trim().length;
  cache.set(node, length);
  return length;
}

function describeElement(node: P5Node): string {
  const tag = node.tagName ?? "element";
  const id = attr(node, "id");
  const classes = (attr(node, "class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2);
  return `${tag}${id ? `#${id}` : ""}${classes.length > 0 ? `.${classes.join(".")}` : ""}`;
}

/**
 * The wrapper chain that holds the page: starting at <body>, descend
 * into the single element child carrying ≥80% of the current node's
 * text, repeatedly. Every element on this chain wraps substantially
 * the whole page, so a narrow cap on any of them collapses the page.
 * A narrow cap on anything OFF this chain (a card, a sidebar, a form)
 * is a section-level choice, not the collapse shape.
 */
function pageLevelChain(body: P5Node, cache: Map<P5Node, number>): P5Node[] {
  const chain: P5Node[] = [body];
  let current = body;
  for (let depth = 0; depth < 12; depth++) {
    const total = textLength(current, cache);
    if (total === 0) break;
    const dominant = elementChildren(current).find(
      (child) => !NON_RENDERED_TAGS.has(child.tagName ?? "") && textLength(child, cache) / total >= 0.8,
    );
    if (!dominant) break;
    chain.push(dominant);
    current = dominant;
  }
  return chain;
}

// ─── Declared-length resolution ──────────────────────────────────────

/** An absolute CSS length in px, or null when the value is relative
 *  (%, vw, auto…), unparseable, or carries no absolute component.
 *  For functional values (min/clamp) the largest absolute component
 *  is the operative desktop size/ceiling. */
function absoluteLengthPx(raw: string): number | null {
  const value = raw.trim().toLowerCase().replace(/\s*!important\s*$/, "");
  if (value === "0") return 0;
  const direct = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value);
  if (direct) {
    const amount = Number.parseFloat(direct[1]);
    return direct[2] === "px" ? amount : amount * 16;
  }
  if (value.includes("(")) {
    const parts = [...value.matchAll(/(-?\d*\.?\d+)(px|rem|em)\b/g)].map((m) =>
      m[2] === "px" ? Number.parseFloat(m[1]) : Number.parseFloat(m[1]) * 16,
    );
    return parts.length > 0 ? Math.max(...parts) : null;
  }
  return null;
}

// ─── Author stylesheet rules ─────────────────────────────────────────

interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
  order: number;
}

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (property && value) declarations.set(property, value);
  }
  return declarations;
}

/** Whether a media query can apply at desktop width. Phone-targeted
 *  queries (any max-width constraint) never describe the desktop
 *  layout, so their rules are excluded — a narrow cap inside a phone
 *  media query is correct behavior, not the collapse shape. */
function mediaAppliesAtDesktop(query: string): boolean {
  return !/max-width/i.test(query);
}

function extractRules(css: string, into: CssRule[], orderStart: number): number {
  let order = orderStart;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (!prelude) continue;
    const lower = prelude.toLowerCase();
    if (lower.startsWith("@media")) {
      if (mediaAppliesAtDesktop(prelude.slice(6))) order = extractRules(body, into, order);
    } else if (lower.startsWith("@layer")) {
      order = extractRules(body, into, order);
    } else if (lower.startsWith("@")) {
      // @theme, @keyframes, @font-face… carry no element selectors.
      continue;
    } else {
      into.push({
        selectors: prelude.split(",").map((s) => s.trim()).filter(Boolean),
        declarations: parseDeclarations(body),
        order: order++,
      });
    }
  }
  return order;
}

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
}

function parseCompound(raw: string): Compound | null {
  const match = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(raw);
  if (!match) return null;
  const compound: Compound = { tag: match[1]?.toLowerCase(), classes: [] };
  for (const token of match[2]?.match(/[.#][\w-]+/g) ?? []) {
    if (token.startsWith("#")) compound.id = token.slice(1);
    else compound.classes.push(token.slice(1));
  }
  return compound;
}

interface SelectorPart {
  compound: Compound;
  /** Combinator joining this part to the previous one. */
  combinator: "descendant" | "child";
}

function parseSelector(selector: string): SelectorPart[] | null {
  if (/[:[*+~]/.test(selector)) return null; // pseudo/attribute/sibling — not statically matched
  const tokens = selector.replace(/>/g, " > ").split(/\s+/).filter(Boolean);
  const parts: SelectorPart[] = [];
  let combinator: "descendant" | "child" = "descendant";
  for (const token of tokens) {
    if (token === ">") {
      combinator = "child";
      continue;
    }
    const compound = parseCompound(token);
    if (!compound) return null;
    parts.push({ compound, combinator });
    combinator = "descendant";
  }
  return parts.length > 0 ? parts : null;
}

function compoundMatches(node: P5Node, compound: Compound): boolean {
  if (compound.tag && node.tagName !== compound.tag) return false;
  if (compound.id && attr(node, "id") !== compound.id) return false;
  if (compound.classes.length > 0) {
    const present = new Set((attr(node, "class") ?? "").split(/\s+/).filter(Boolean));
    if (!compound.classes.every((c) => present.has(c))) return false;
  }
  return true;
}

function selectorMatches(node: P5Node, parts: SelectorPart[]): boolean {
  let index = parts.length - 1;
  if (!compoundMatches(node, parts[index].compound)) return false;
  let current: P5Node | undefined = node;
  while (index > 0) {
    const combinator = parts[index].combinator;
    index--;
    if (combinator === "child") {
      current = current.parentNode;
      if (!current || !current.tagName || !compoundMatches(current, parts[index].compound)) return false;
    } else {
      let ancestor: P5Node | undefined = current.parentNode;
      let found: P5Node | undefined;
      while (ancestor) {
        if (ancestor.tagName && compoundMatches(ancestor, parts[index].compound)) {
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

function specificity(parts: SelectorPart[]): [number, number, number] {
  let ids = 0;
  let classes = 0;
  let tags = 0;
  for (const part of parts) {
    if (part.compound.id) ids++;
    classes += part.compound.classes.length;
    if (part.compound.tag) tags++;
  }
  return [ids, classes, tags];
}

/** The winning declared value for one property on one element from
 *  the author stylesheet, by (specificity, source order). */
function stylesheetValue(node: P5Node, rules: CssRule[], property: string): string | null {
  let best: { value: string; spec: [number, number, number]; order: number } | null = null;
  for (const rule of rules) {
    const value = rule.declarations.get(property);
    if (value === undefined) continue;
    for (const selector of rule.selectors) {
      const parts = parseSelector(selector);
      if (!parts || !selectorMatches(node, parts)) continue;
      const spec = specificity(parts);
      if (
        !best ||
        spec[0] > best.spec[0] ||
        (spec[0] === best.spec[0] && spec[1] > best.spec[1]) ||
        (spec[0] === best.spec[0] && spec[1] === best.spec[1] && spec[2] > best.spec[2]) ||
        (spec[0] === best.spec[0] && spec[1] === best.spec[1] && spec[2] === best.spec[2] && rule.order > best.order)
      ) {
        best = { value, spec, order: rule.order };
      }
    }
  }
  return best?.value ?? null;
}

// ─── Tailwind utility resolution ─────────────────────────────────────

const TAILWIND_MAX_W_SCALE: Record<string, number> = {
  "0": 0,
  xs: 320,
  sm: 384,
  md: 448,
  lg: 512,
  xl: 576,
  "2xl": 672,
  "3xl": 768,
  "4xl": 896,
  "5xl": 1024,
  "6xl": 1152,
  "7xl": 1280,
};

const BREAKPOINT_RANK: Record<string, number> = { sm: 1, md: 2, lg: 3, xl: 4, "2xl": 5 };

/**
 * The desktop-effective absolute length a Tailwind utility channel
 * declares for one property, or null when the channel declares
 * nothing absolute (relative values, an explicit no-cap, or no token
 * at all). Min-width variants cascade upward, so the token with the
 * largest breakpoint rank is the one in force at desktop width;
 * state variants (hover, dark…) do not describe the resting layout
 * and are ignored.
 */
function tailwindValue(node: P5Node, property: "max-width" | "width"): number | null {
  const prefix = property === "max-width" ? "max-w-" : "w-";
  const tokens = (attr(node, "class") ?? "").split(/\s+/).filter(Boolean);
  let winner: { rank: number; px: number | null } | null = null;
  for (const token of tokens) {
    const segments = token.split(":");
    const utility = segments[segments.length - 1];
    if (!utility.startsWith(prefix)) continue;
    const variants = segments.slice(0, -1);
    if (variants.some((v) => !(v in BREAKPOINT_RANK))) continue;
    const rank = variants.reduce((max, v) => Math.max(max, BREAKPOINT_RANK[v] ?? 0), 0);
    const key = utility.slice(prefix.length);
    let px: number | null = null;
    if (key.startsWith("[") && key.endsWith("]")) {
      px = absoluteLengthPx(key.slice(1, -1));
    } else if (property === "max-width") {
      if (key === "none") px = Number.POSITIVE_INFINITY;
      else if (key in TAILWIND_MAX_W_SCALE) px = TAILWIND_MAX_W_SCALE[key];
    } else if (/^\d+(\.\d+)?$/.test(key)) {
      px = Number.parseFloat(key) * 4; // spacing scale: 0.25rem per step
    } else if (key === "px") {
      px = 1;
    }
    if (!winner || rank >= winner.rank) winner = { rank, px };
  }
  if (!winner || winner.px === null || !Number.isFinite(winner.px)) return null;
  return winner.px;
}

// ─── The judge ───────────────────────────────────────────────────────

/** Resolve one property on one element across the declaration
 *  channels, in cascade order: inline style, then the author
 *  stylesheet, then Tailwind utilities. Returns the declared string
 *  and its absolute px, or null when the winning channel declares
 *  nothing absolute. */
function resolvedDeclaredLength(
  node: P5Node,
  rules: CssRule[],
  property: "max-width" | "width",
): { declared: string; px: number } | null {
  const inline = parseDeclarations(attr(node, "style") ?? "").get(property);
  if (inline !== undefined) {
    const px = absoluteLengthPx(inline);
    return px === null ? null : { declared: inline, px };
  }
  const fromSheet = stylesheetValue(node, rules, property);
  if (fromSheet !== null) {
    const px = absoluteLengthPx(fromSheet);
    return px === null ? null : { declared: fromSheet, px };
  }
  const fromTailwind = tailwindValue(node, property);
  return fromTailwind === null ? null : { declared: `${fromTailwind}px`, px: fromTailwind };
}

/** Proven desktop-collapse shapes in one HTML document (path-less —
 *  checkRenderedLayout stamps the path). */
export function findLayoutViolations(html: string): Array<Omit<LayoutViolation, "path">> {
  let doc: P5Node;
  try {
    doc = parse(html) as unknown as P5Node;
  } catch {
    return [];
  }
  const body = findFirst(doc, "body");
  if (!body) return [];

  const rules: CssRule[] = [];
  let order = 0;
  const collectStyles = (node: P5Node): void => {
    if (node.tagName === "style") {
      const text = (node.childNodes ?? []).map((c) => c.value ?? "").join("");
      order = extractRules(text, rules, order);
    }
    for (const child of node.childNodes ?? []) collectStyles(child);
  };
  collectStyles(doc);

  const cache = new Map<P5Node, number>();
  const violations: Array<Omit<LayoutViolation, "path">> = [];
  for (const element of pageLevelChain(body, cache)) {
    const maxWidth = resolvedDeclaredLength(element, rules, "max-width");
    if (maxWidth && maxWidth.px < LAYOUT_MAX_WIDTH_FLOOR_PX) {
      violations.push({
        element: describeElement(element),
        property: "max-width",
        declared: maxWidth.declared,
        declaredPx: maxWidth.px,
        thresholdPx: LAYOUT_MAX_WIDTH_FLOOR_PX,
      });
    }
    const width = resolvedDeclaredLength(element, rules, "width");
    if (width && width.px < LAYOUT_FIXED_WIDTH_FLOOR_PX) {
      violations.push({
        element: describeElement(element),
        property: "width",
        declared: width.declared,
        declaredPx: width.px,
        thresholdPx: LAYOUT_FIXED_WIDTH_FLOOR_PX,
      });
    }
  }
  return violations;
}

function isHtmlFilePath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

/**
 * Read back the run's mutated HTML files and judge each one for the
 * desktop-collapse shape. Mirrors checkTextContrast's evidence rules:
 * unreadable files are skipped, and a candidate set truncated by the
 * read-back cap makes a clean result "unknown" rather than proven.
 */
export async function checkRenderedLayout(opts: {
  candidatePaths: ReadonlyArray<string>;
  readFile: (path: string) => Promise<{ content: string }>;
}): Promise<RenderedLayoutCheck> {
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
  const violations: LayoutViolation[] = [];
  for (const path of candidates) {
    try {
      const { content } = await opts.readFile(path);
      if (typeof content !== "string") continue;
      checkedFiles.push(path);
      for (const violation of findLayoutViolations(content)) {
        violations.push({ path, ...violation });
      }
    } catch {
      // Not readable — not checked. Other candidates may still answer.
    }
  }

  return {
    applies: checkedFiles.length > 0 && (violations.length > 0 || !truncated),
    violations,
    checkedFiles,
    unverifiableFiles: [],
  };
}

/** The honest user-facing sentence for a page that collapses at
 *  desktop width. */
export function renderedLayoutFailureMessage(violations: LayoutViolation[]): string {
  const first = violations[0];
  if (!first) return "I wrote the page, but its layout would collapse into a narrow column on a desktop screen, so I can't confirm it landed as intended. Please try again.";
  const more = violations.length > 1 ? ` (and ${violations.length - 1} more like it)` : "";
  return (
    `I wrote the page, but on a desktop screen it would be squeezed into a narrow column — ` +
    `in ${first.path} the whole page sits inside <${first.element}>, whose ${first.property} is ` +
    `${first.declared} (${first.declaredPx}px), so the content can never spread wider than that ` +
    `no matter how wide the screen is${more}. A page that collapses on desktop is not a finished ` +
    `page, so I can't confirm this build landed as intended. Please try again.`
  );
}

/** The mid-loop feedback fed back for the ONE automatic repair attempt. */
export function renderedLayoutRepairPrompt(violations: LayoutViolation[]): string {
  const lines = violations
    .slice(0, 5)
    .map(
      (v) =>
        `- ${v.path}: <${v.element}> declares ${v.property}: ${v.declared} (${v.declaredPx}px) around the whole page`,
    )
    .join("\n");
  return (
    `Verification failed: the page you just wrote would COLLAPSE INTO A NARROW COLUMN on a desktop ` +
    `screen — a wrapper around the whole page caps its width at phone size:\n${lines}\n` +
    `Fix the file now: page content lives in a full-width shell, and sections centre their content ` +
    `in a WIDE container (w-full max-w-6xl or max-w-7xl, mx-auto, px-4 or px-6) — the container caps ` +
    `at desktop content width (about 64rem or more), never at phone width. Remove any fixed pixel ` +
    `width from layout containers, and make card/item grids expand with the screen (1 column on ` +
    `phones, 2–4 columns at md/lg). Then finish.`
  );
}
