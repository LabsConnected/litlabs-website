import "server-only";

/**
 * Visual enrichment for generated static sites — the deterministic floor
 * under "premium" output.
 *
 * Models reliably write markup; they unreliably call image tools (each
 * image.generate call is an approval pause, and the 2026-11 golden run
 * shipped Ember Roast with zero images). This pass runs in code after a
 * static-site mutation and:
 *
 *   1. Materializes `<img data-litt-image="keywords">` slots and
 *      `data-litt-bg="keywords"` backgrounds into real project assets.
 *   2. Repairs broken relative refs, rehosts external hotlinks, and
 *      replaces placeholder services with real photography.
 *   3. Falls back to a generated local SVG placeholder (honest, never a
 *      broken <img>) when every provider is unavailable.
 *
 * Image sourcing is free-only (Pexels free tier → pollinations →
 * loremflickr → picsum). No paid API is ever called from here.
 */

import { insertAssetFromUrl } from "@/lib/litt-intelligence/tool-handlers-v2";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { resolveSlotImage } from "./resolver";
import { auditStaticSiteHtml, extractImageRefs, type VisualAudit } from "./audit";

export interface EnrichReport {
  filesScanned: number;
  imagesResolved: number;
  imagesFailed: number;
  placeholdersUsed: number;
  providersUsed: string[];
  filesChanged: string[];
  audit: VisualAudit | null;
}

const MAX_IMAGES_PER_RUN = 8;
const BG_SLOT_RE = /<(\w+)([^>]*)\bdata-litt-bg\s*=\s*["']([^"']*)["']([^>]*)>/gi;
const SRC_ATTR_RE = /(\bsrc\s*=\s*["'])([^"']*)(["'])/i;
const STYLE_ATTR_RE = /\bstyle\s*=\s*["']([^"']*)["']/i;

const PLACEHOLDER_SVG_PATH = "assets/images/placeholder.svg";
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1a22"/><stop offset="1" stop-color="#2c2c38"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="800" cy="400" r="90" fill="none" stroke="#5a5a6e" stroke-width="3" opacity="0.6"/><rect x="770" y="470" width="60" height="8" rx="4" fill="#5a5a6e" opacity="0.6"/></svg>`;

interface TransportLike {
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
  writeFile(path: string, content: string): Promise<{ saved: boolean }>;
}

function slotKeywords(attr: string, fallback: string): string {
  const kw = attr.trim();
  return kw || fallback;
}

async function ensurePlaceholderSvg(transport: TransportLike): Promise<string | null> {
  try {
    const existing = await transport.listFiles("assets/images").catch(() => null);
    if (existing?.entries?.some((e) => e.name === "placeholder.svg")) {
      return PLACEHOLDER_SVG_PATH;
    }
    await transport.writeFile(PLACEHOLDER_SVG_PATH, PLACEHOLDER_SVG);
    return PLACEHOLDER_SVG_PATH;
  } catch {
    return null;
  }
}

/**
 * Enrich the static site in a workspace. Runs server-side; returns a
 * report describing exactly what was materialized — the caller surfaces
 * it (progress event / run evidence). Never throws: enrichment failure
 * must degrade to the unenriched artifact, not break the run.
 */
export async function enrichStaticSiteVisuals(
  transport: WorkspaceTransport,
  opts: { topicKeywords?: string; maxImages?: number } = {},
): Promise<EnrichReport> {
  const report: EnrichReport = {
    filesScanned: 0,
    imagesResolved: 0,
    imagesFailed: 0,
    placeholdersUsed: 0,
    providersUsed: [],
    filesChanged: [],
    audit: null,
  };
  const budget = opts.maxImages ?? MAX_IMAGES_PER_RUN;
  const topic = opts.topicKeywords ?? "professional photography";
  try {
    const root = await transport.listFiles("");
    const htmlFiles = root.entries
      .filter((e) => e.type === "file" && /\.html?$/i.test(e.name))
      .map((e) => e.name);
    if (htmlFiles.length === 0) return report;

    const fileSet = new Set<string>();
    const collect = async (dir: string, prefix: string, depth: number) => {
      if (depth > 3) return;
      const res = await transport.listFiles(dir).catch(() => null);
      for (const e of res?.entries ?? []) {
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.type === "file") fileSet.add(p);
        else if (e.type === "directory") await collect(p, p, depth + 1);
      }
    };
    await collect("", "", 0);

    let seed = 1;
    const resolve = async (keywords: string) => {
      if (report.imagesResolved + report.imagesFailed >= budget) return null;
      const resolved = await resolveSlotImage(keywords, seed++);
      if (!resolved) {
        report.imagesFailed += 1;
        return null;
      }
      const saved = await insertAssetFromUrl(
        resolved.url,
        { nameHint: keywords.slice(0, 30) },
        transport,
      );
      if (!saved.success || !saved.sitePath) {
        report.imagesFailed += 1;
        return null;
      }
      report.imagesResolved += 1;
      if (!report.providersUsed.includes(resolved.provider)) {
        report.providersUsed.push(resolved.provider);
      }
      // Treat the just-materialized file as on-disk so the repair pass
      // below does not "fix" it as a missing relative ref.
      fileSet.add(saved.sitePath.replace(/^\//, ""));
      if (saved.path) fileSet.add(saved.path.replace(/^\//, ""));
      return saved.sitePath;
    };

    for (const file of htmlFiles) {
      const { content } = await transport.readFile(file);
      let html = content;
      let changed = false;
      report.filesScanned += 1;

      // 1. Materialize <img data-litt-image="kw"> slots.
      const slots = extractImageRefs(html).filter((r) => r.kind === "img" && r.keywords !== null);
      for (const slot of slots) {
        const sitePath = await resolve(slotKeywords(slot.keywords ?? "", topic));
        const finalSrc = sitePath ?? (await ensurePlaceholderSvg(transport));
        if (!finalSrc) continue;
        if (!sitePath) {
          report.placeholdersUsed += 1;
          fileSet.add(PLACEHOLDER_SVG_PATH);
        }
        const newTag = slot.raw
          .replace(/ src\s*=\s*["'][^"']*["']/i, ` src="${finalSrc}"`)
          .replace(/\s*data-litt-image\s*=\s*["'][^"']*["']/i, "");
        const withSrc = / src\s*=/i.test(newTag) ? newTag : newTag.replace(/<img\b/i, `<img src="${finalSrc}"`);
        html = html.replace(slot.raw, withSrc);
        changed = true;
      }

      // 2. Materialize data-litt-bg="kw" → real background-image.
      const bgMatches = [...html.matchAll(BG_SLOT_RE)];
      for (const m of bgMatches) {
        const [full, tagName, pre, kw, post] = m;
        const sitePath = await resolve(slotKeywords(String(kw), topic));
        if (!sitePath) continue;
        const styleM = (pre + post).match(STYLE_ATTR_RE);
        const bgDecl = `background-image:url('${sitePath}');background-size:cover;background-position:center;`;
        const inner = styleM
          ? (pre + post).replace(STYLE_ATTR_RE, (s) => `${s.slice(0, -1)} ${bgDecl}"`)
          : `${pre} style="${bgDecl}"${post}`;
        html = html.replace(full, `<${tagName}${inner}>`);
        changed = true;
      }

      // 3. Repair broken / external / placeholder <img src>.
      const refs = extractImageRefs(html).filter((r) => r.kind === "img" && r.src);
      for (const ref of refs) {
        const src = ref.src;
        const isExternal = /^https?:\/\//i.test(src);
        const isPlaceholder = /via\.placeholder|placehold\.|dummyimage|fakeimg/i.test(src);
        const relMissing =
          !isExternal &&
          !/^(data:|blob:)/i.test(src) &&
          !fileSet.has(src.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0]) &&
          !fileSet.has(`public/${src.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0]}`);
        if (isExternal && !isPlaceholder) {
          // Rehost the hotlink into the project — persists in deploys.
          const saved = await insertAssetFromUrl(src, { nameHint: "external-image" }, transport)
            .catch(() => null);
          if (saved?.success && saved.sitePath) {
            html = html.replace(ref.raw, ref.raw.replace(SRC_ATTR_RE, `$1${saved.sitePath}$3`));
            changed = true;
            fileSet.add(saved.sitePath.replace(/^\//, ""));
            if (saved.path) fileSet.add(saved.path.replace(/^\//, ""));
            if (!report.providersUsed.includes("external-rehost")) report.providersUsed.push("external-rehost");
          }
        } else if (isPlaceholder || relMissing) {
          const alt = ref.raw.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
          const sitePath = await resolve(alt || topic);
          const finalSrc = sitePath ?? (await ensurePlaceholderSvg(transport));
          if (!finalSrc) continue;
          if (!sitePath) {
            report.placeholdersUsed += 1;
            fileSet.add(PLACEHOLDER_SVG_PATH);
          }
          html = html.replace(ref.raw, ref.raw.replace(SRC_ATTR_RE, `$1${finalSrc}$3`));
          changed = true;
        }
      }

      if (changed) {
        await transport.writeFile(file, html);
        report.filesChanged.push(file);
      }
    }

    // Final audit of the primary entry file after rewriting.
    const entry = htmlFiles.find((f) => /^index\.html?$/i.test(f)) ?? htmlFiles[0];
    const { content: finalHtml } = await transport.readFile(entry);
    const postFiles = new Set(fileSet);
    for (const p of report.filesChanged) postFiles.add(p);
    const assets = await transport.listFiles("assets/images").catch(() => null);
    for (const e of assets?.entries ?? []) if (e.type === "file") postFiles.add(`assets/images/${e.name}`);
    report.audit = auditStaticSiteHtml(finalHtml, postFiles);
    return report;
  } catch {
    return report;
  }
}
