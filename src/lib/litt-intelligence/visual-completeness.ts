import "server-only";

/**
 * Visual-completeness check — proves that imagery a built site references
 * actually exists in the workspace.
 *
 * A run that writes `<img src="hero.jpg">` without producing `hero.jpg`,
 * or that leaves `src=""` / a placeholder-domain URL behind, has NOT
 * delivered what the user sees as a finished page. This check scans the
 * workspace's markup and stylesheets for image references and verifies
 * each one against the real file listing. Results feed the quality gate
 * as TEST evidence: any failure files `detail.passed === false`, which
 * blocks success the same way a failing typecheck does.
 *
 * External image URLs cannot be verified from a static listing, so they
 * are reported as `external` for the caller — except known placeholder /
 * stock services, which always fail: they mean imagery was requested but
 * a fake stand-in was shipped.
 */

export interface VisualCompletenessReport {
  ok: boolean;
  /** Local refs (img/link/url()/poster) that resolve to no workspace file. */
  missing: Array<{ ref: string; from: string }>;
  /** Empty `#`/blank or known placeholder/stock service URLs. */
  placeholders: Array<{ ref: string; from: string }>;
  /** External non-placeholder URLs — unverified, never counted as failures. */
  external: Array<{ ref: string; from: string }>;
  /** User asked for imagery but no real image reference exists anywhere. */
  omittedImagery: boolean;
  /** Number of markup/style files scanned. */
  scannedFiles: number;
}

const SCAN_EXTENSIONS = /\.(html?|css)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)(\?|#|$)/i;

const PLACEHOLDER_HOSTS =
  /(?:placehold\.co|via\.placeholder\.com|placekitten|dummyimage|loremflickr|picsum\.photos|lorem\.ipsum|unsplash\.com|source\.unsplash|images\.unsplash|pexels\.com|pixabay\.com)/i;

const IMAGERY_REQUEST_PATTERN =
  /\b(image|images|picture|pictures|photo|photos|photograph|hero\b|banner|artwork|album art|cover art|logo|icon|illustration|thumbnail|gallery|background image|avatar|portrait)\b/i;

/** Capture img/link/source src+srcset, poster attrs, and CSS url() refs. */
const REF_PATTERNS: RegExp[] = [
  /(?:src|srcset|poster|href)\s*=\s*["']([^"']+)["']/gi,
  /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
];

function isImageishRef(ref: string): boolean {
  const clean = ref.split("?")[0].split("#")[0];
  return IMAGE_EXTENSIONS.test(clean) || /images?\//i.test(clean);
}

function resolveRelative(ref: string, fromFile: string): string {
  const clean = ref.split("?")[0].split("#")[0];
  if (clean.startsWith("/")) return clean.replace(/^\/+/, "");
  const dir = fromFile.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") dir.pop();
    else dir.push(seg);
  }
  return dir.join("/");
}

/**
 * Scan `contents` (path → text) against the full workspace `pathSet`.
 */
export function checkVisualCompleteness(opts: {
  contents: Record<string, string>;
  pathSet: Set<string>;
  userRequest?: string | null;
}): VisualCompletenessReport {
  const report: VisualCompletenessReport = {
    ok: true,
    missing: [],
    placeholders: [],
    external: [],
    omittedImagery: false,
    scannedFiles: 0,
  };
  let sawRealImageRef = false;

  for (const [file, content] of Object.entries(opts.contents)) {
    if (!SCAN_EXTENSIONS.test(file)) continue;
    report.scannedFiles++;
    for (const pattern of REF_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const raw = match[1].trim();
        // srcset entries can carry descriptors ("x 2x"); take the URL part.
        const ref = raw.split(/[\s,]+/)[0];
        if (!ref) continue;
        if (ref.startsWith("data:")) {
          if (ref.startsWith("data:image")) sawRealImageRef = true;
          continue;
        }
        if (ref === "#" || ref.startsWith("javascript:")) {
          if (isImageishRef(match[0]) || match[0].toLowerCase().includes("src")) {
            report.placeholders.push({ ref: raw.slice(0, 120), from: file });
          }
          continue;
        }
        if (/^https?:\/\//i.test(ref)) {
          if (PLACEHOLDER_HOSTS.test(ref)) {
            report.placeholders.push({ ref: ref.slice(0, 160), from: file });
          } else if (isImageishRef(ref)) {
            sawRealImageRef = true;
            report.external.push({ ref: ref.slice(0, 160), from: file });
          }
          continue;
        }
        if (!isImageishRef(ref)) continue;
        const resolved = resolveRelative(ref, file);
        if (opts.pathSet.has(resolved)) {
          sawRealImageRef = true;
        } else {
          report.missing.push({ ref: ref.slice(0, 160), from: file });
        }
      }
    }
  }

  if (opts.userRequest && IMAGERY_REQUEST_PATTERN.test(opts.userRequest)) {
    report.omittedImagery = !sawRealImageRef && report.scannedFiles > 0;
  }
  report.ok =
    report.missing.length === 0 &&
    report.placeholders.length === 0 &&
    !report.omittedImagery;
  return report;
}

const MAX_LIST_FILES = 500;
const MAX_SCAN_FILES = 60;

interface FileTransport {
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
}

/**
 * Enumerate the workspace via `transport`, read markup/style files, and
 * run {@link checkVisualCompleteness}. Returns null when there is nothing
 * visual to check (no markup files) so callers file no evidence at all.
 * Never throws: transport failures yield null, not a broken run.
 */
export async function runVisualCompletenessCheck(
  transport: FileTransport,
  opts: { userRequest?: string | null } = {},
): Promise<VisualCompletenessReport | null> {
  try {
    const paths: string[] = [];
    const queue = [""];
    while (queue.length > 0 && paths.length < MAX_LIST_FILES) {
      const current = queue.shift()!;
      const { entries } = await transport.listFiles(current);
      for (const entry of entries) {
        const relative = current ? `${current}/${entry.name}` : entry.name;
        if (entry.type === "directory") {
          if (!/^(node_modules|\.git|\.next|dist|build)$/i.test(entry.name)) {
            queue.push(relative);
          }
        } else {
          paths.push(relative);
        }
        if (paths.length >= MAX_LIST_FILES) break;
      }
    }

    const scanTargets = paths.filter((p) => SCAN_EXTENSIONS.test(p)).slice(0, MAX_SCAN_FILES);
    if (scanTargets.length === 0) return null;

    const contents: Record<string, string> = {};
    for (const target of scanTargets) {
      try {
        contents[target] = (await transport.readFile(target)).content;
      } catch {
        // Unreadable file — the read-back check already records that honestly.
      }
    }
    if (Object.keys(contents).length === 0) return null;

    return checkVisualCompleteness({
      contents,
      pathSet: new Set(paths),
      userRequest: opts.userRequest,
    });
  } catch {
    return null;
  }
}
