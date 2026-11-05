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
  issues: string[];
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
        if (!files.has(rel) && !files.has(publicRel)) {
          broken.push(ref.src);
        }
      }
    }
  }
  if (PLACEHOLDER_TEXT.test(html)) placeholders.push("(placeholder text)");

  const issues: string[] = [];
  if (broken.length) issues.push(`${broken.length} broken image reference(s)`);
  if (external.length) issues.push(`${external.length} external hotlinked image(s)`);
  if (placeholders.length) issues.push(`${placeholders.length} placeholder image/text item(s)`);
  if (imgCount === 0) issues.push("no imagery in page");
  if (!hasHeroImagery) issues.push("hero/lead section has no imagery");

  return {
    imageCount: imgCount,
    slotCount: refs.filter((r) => r.keywords).length,
    brokenRefs: broken,
    externalRefs: external,
    placeholderRefs: placeholders,
    hasHeroImagery,
    issues,
  };
}
