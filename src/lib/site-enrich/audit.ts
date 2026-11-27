import "server-only";

/**
 * Static-site visual completeness audit — pure HTML inspection, no browser
 * needed. This is the production answer to "does the generated page have
 * real imagery?": host execution (and therefore screenshots) is disabled
 * in production static workspaces, so the audit works on the artifact
 * itself. The golden harness adds the desktop/mobile screenshot pass.
 */

export interface ImageRef {
  kind: "img" | "css";
  src: string;
  /** keywords from data-litt-image / data-litt-bg when present. */
  keywords: string | null;
  /** the full matched markup, for rewriting. */
  raw: string;
  index: number;
}

export interface VisualAudit {
  imageCount: number;
  slotCount: number;
  brokenRefs: string[];
  externalRefs: string[];
  placeholderRefs: string[];
  hasHeroImagery: boolean;
  /** ACC-10 Defect 3: the page carries SOME styling — a <style> block
   *  with rules, a stylesheet link, a utility-framework CDN script, or
   *  several inline style attributes. A full page with none of these
   *  renders as bare unstyled HTML (Acceptance Run 1 on 4adcdd4c). */
  hasStyling: boolean;
  /** ACC-10 Defect 3: raw markdown link syntax ([text](url)) left in
   *  the HTML — it renders literally in the browser and is never valid
   *  output (Acceptance Run 1 on 4adcdd4c shipped one as the contact
   *  email). */
  markdownLeaks: string[];
  issues: string[];
}

const STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?\{[^}]*\}/i;
const STYLESHEET_LINK_RE = /<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i;
const FRAMEWORK_CDN_RE = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:tailwind|bootstrap)[^"']*["']/i;
const INLINE_STYLE_RE = /\bstyle\s*=\s*["'][^"']+["']/gi;
const MARKDOWN_LINK_RE = /\[[^\]\n]{1,80}\]\((?:https?:\/\/|mailto:)[^)\s]+\)/g;

/** True when the document carries any styling signal at all. */
export function detectStyling(html: string): boolean {
  if (STYLE_BLOCK_RE.test(html)) return true;
  if (STYLESHEET_LINK_RE.test(html)) return true;
  if (FRAMEWORK_CDN_RE.test(html)) return true;
  const inline = html.match(INLINE_STYLE_RE);
  return (inline?.length ?? 0) >= 3;
}

/** Raw markdown link syntax left in the document (capped list). */
export function detectMarkdownLeaks(html: string): string[] {
  return [...html.matchAll(MARKDOWN_LINK_RE)].map((m) => m[0]).slice(0, 5);
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const DATA_KW_TAG_RE = /\bdata-litt-image\s*=\s*["']([^"']+)["']/i;
const DATA_BG_RE = /\bdata-litt-bg\s*=\s*["']([^"']+)["']/gi;
const DATA_BG_TAG_RE = /\bdata-litt-bg\s*=\s*["']([^"']+)["']/i;
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

const PLACEHOLDER_HOSTS = [
  "via.placeholder.com",
  "placehold.co",
  "placehold.it",
  "dummyimage.com",
  "loremflickr.com/g/",
  "fakeimg.pl",
  "picsum.photos/200",
];
const PLACEHOLDER_TEXT = /lorem ipsum|placeholder text|image coming soon|todo:?\s*image/i;

function isExternal(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function isDataOrBlob(src: string): boolean {
  return /^(data:|blob:|about:|javascript:)/i.test(src);
}

function isPlaceholderSrc(src: string): boolean {
  const lower = src.toLowerCase();
  return PLACEHOLDER_HOSTS.some((h) => lower.includes(h)) || /placeholder/.test(lower);
}

/** Extract every image reference from an HTML document. */
export function extractImageRefs(html: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const m of html.matchAll(IMG_TAG_RE)) {
    const tag = m[0];
    const kw = tag.match(DATA_KW_TAG_RE)?.[1] ?? null;
    const src = tag.match(SRC_RE)?.[1] ?? "";
    refs.push({ kind: "img", src, keywords: kw, raw: tag, index: m.index ?? 0 });
  }
  for (const m of html.matchAll(DATA_BG_RE)) {
    refs.push({ kind: "css", src: "", keywords: m[1], raw: m[0], index: m.index ?? 0 });
  }
  for (const m of html.matchAll(CSS_URL_RE)) {
    const src = m[1].trim();
    if (src && !isDataOrBlob(src)) {
      refs.push({ kind: "css", src, keywords: null, raw: m[0], index: m.index ?? 0 });
    }
  }
  return refs;
}

function normalizeRelative(src: string): string {
  return src.split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, "");
}

/**
 * Resolve a page-relative reference against the directory of the file
 * that references it — standard relative-URL resolution, the same
 * semantics the deploy validator applies at publish. The audit itself
 * judges refs root-relative (the convention generated entry pages
 * use); callers auditing a NESTED page use this to avoid condemning
 * "../assets/…" references that resolve to real files. ".." pops a
 * segment and clamps at the root; the ref is expected pre-normalized
 * (no query/hash, no leading slash).
 */
export function resolveRefAgainstDir(ref: string, dir: string): string {
  if (!dir) return ref;
  const out = dir.split("/").filter(Boolean);
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * Whether a referenced asset exists in the workspace file set under
 * EITHER reading: as written (root-relative) or resolved against the
 * referencing file's directory — each with the `public/` prefix
 * variant the audit accepts. Used on repair paths, which must never
 * rewrite a reference that exists under any legitimate reading.
 */
export function refExistsInFileSet(ref: string, dir: string, files: ReadonlySet<string>): boolean {
  const candidates = dir ? [ref, resolveRefAgainstDir(ref, dir)] : [ref];
  return candidates.some((c) => files.has(c) || files.has(`public/${c}`));
}

/**
 * Audit an HTML document against the workspace file set.
 * `files` is the set of workspace-relative paths that exist on disk.
 */
export function auditStaticSiteHtml(html: string, files: ReadonlySet<string>): VisualAudit {
  const refs = extractImageRefs(html);
  const broken: string[] = [];
  const external: string[] = [];
  const placeholders: string[] = [];
  let imgCount = 0;
  let hasHeroImagery = false;

  const heroMatch = html.match(/<(section|header|div)[^>]*(hero|banner|jumbotron|masthead)[^>]*>[\s\S]{0,4000}/i);
  const heroSlice = heroMatch ? heroMatch[0] : html.slice(0, Math.min(html.length, 4000));
  hasHeroImagery = /<img\b/i.test(heroSlice) || /url\(/i.test(heroSlice) || DATA_BG_TAG_RE.test(heroSlice) || DATA_KW_TAG_RE.test(heroSlice);

  for (const ref of refs) {
    if (ref.kind === "img" || (ref.kind === "css" && ref.src)) {
      imgCount += 1;
      if (!ref.src || ref.src === "#") {
        broken.push(ref.src || "(empty src)");
      } else if (isDataOrBlob(ref.src)) {
        // inline data — fine
      } else if (isExternal(ref.src)) {
        if (isPlaceholderSrc(ref.src)) placeholders.push(ref.src);
        else external.push(ref.src);
      } else {
        const rel = normalizeRelative(ref.src);
        const publicRel = `public/${rel}`;
        if (isPlaceholderSrc(ref.src)) {
          // A placeholder reference is unresolved BY MEANING — even when
          // the placeholder file itself exists on disk. Production defect
          // 2026-11-11 (LiTT Food Court): two slots shipped pointing at
          // assets/images/placeholder.svg; the file existed, so the
          // existence check below passed the refs as "resolved" and the
          // quality gate saw a clean page with dark empty boxes.
          placeholders.push(ref.src);
        } else if (!files.has(rel) && !files.has(publicRel)) {
          broken.push(ref.src);
        }
      }
    }
  }
  if (PLACEHOLDER_TEXT.test(html)) placeholders.push("(placeholder text)");

  const hasStyling = detectStyling(html);
  const markdownLeaks = detectMarkdownLeaks(html);

  const issues: string[] = [];
  if (broken.length) issues.push(`${broken.length} broken image reference(s)`);
  if (external.length) issues.push(`${external.length} external hotlinked image(s)`);
  if (placeholders.length) issues.push(`${placeholders.length} placeholder image/text item(s)`);
  if (imgCount === 0) issues.push("no imagery in page");
  if (!hasHeroImagery) issues.push("hero/lead section has no imagery");
  if (!hasStyling) issues.push("page has no styling (unstyled HTML)");
  if (markdownLeaks.length) issues.push(`${markdownLeaks.length} raw markdown link(s) in page`);

  return {
    imageCount: imgCount,
    slotCount: refs.filter((r) => r.keywords).length,
    brokenRefs: broken,
    externalRefs: external,
    placeholderRefs: placeholders,
    hasHeroImagery,
    hasStyling,
    markdownLeaks,
    issues,
  };
}
