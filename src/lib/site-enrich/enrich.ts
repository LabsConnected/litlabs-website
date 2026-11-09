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

import { createHash } from "crypto";
import { insertAssetFromUrl, type InsertAssetResult } from "@/lib/litt-intelligence/tool-handlers-v2";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { resolveSlotImage, type ProviderAttempt, type ResolvedImage } from "./resolver";
import { auditStaticSiteHtml, extractImageRefs, type VisualAudit } from "./audit";

export interface EnrichReport {
  filesScanned: number;
  imagesResolved: number;
  imagesFailed: number;
  placeholdersUsed: number;
  providersUsed: string[];
  /** Providers that were attempted but did not produce an image —
   *  "unconfigured" means the provider's credential env is absent. Lets
   *  run evidence name exactly which lane failed instead of guessing. */
  providersFailed: string[];
  filesChanged: string[];
  audit: VisualAudit | null;
}

const MAX_IMAGES_PER_RUN = 8;
// Golden acceptance requires ≥3 real photos >8 KB on the deployed entry
// page. Images persisted below this size (icons, tiny thumbs) are real
// assets but do not count toward the floor.
const MIN_REAL_PHOTOS = 3;
const MIN_REAL_PHOTO_BYTES = 8000;
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
    providersFailed: [],
    filesChanged: [],
    audit: null,
  };
  const budget = opts.maxImages ?? MAX_IMAGES_PER_RUN;
  const topic = opts.topicKeywords ?? "professional photography";
  // One overall deadline for every network call in this run. Enrichment
  // is additive — it must never stall the build, but the budget must
  // still fit the real-photo floor: each resolve is provider probes plus
  // a full image download, and the floor can need three of them. The
  // 2026-11-08 staging run proved 3s is physically incapable — a single
  // resolve consumed it and the floor shipped 1/3 photos. 30s still
  // bounds pathological providers (each probe keeps its own 12s timeout)
  // while giving the floor room to do its job. Override with
  // ENRICH_TOTAL_TIMEOUT_MS to tune.
  const totalTimeoutMs = Number(process.env.ENRICH_TOTAL_TIMEOUT_MS) || 30_000;
  const overallSignal = AbortSignal.timeout(totalTimeoutMs);
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
    // Site-relative paths of persisted images known to be too small to
    // satisfy the real-photo floor — they are kept (real content) but do
    // not count toward MIN_REAL_PHOTOS.
    const smallImages = new Set<string>();
    const trackSize = (sitePath: string | undefined, path: string | undefined, sizeBytes: number | undefined) => {
      if (sizeBytes !== undefined && sizeBytes <= MIN_REAL_PHOTO_BYTES) {
        if (sitePath) smallImages.add(sitePath.replace(/^\//, ""));
        if (path) smallImages.add(path.replace(/^\//, ""));
      }
    };
    const usedHashes = new Set<string>();
    const contentHash = async (sitePath: string) => {
      try {
        const { content } = await transport.readFile(sitePath);
        return createHash("md5").update(content).digest("hex");
      } catch {
        return null;
      }
    };
    const providerAttempts: ProviderAttempt[] = [];
    // One resolve = one persisted image. A provider can pass the URL probe
    // and still fail the download (HTTP 5xx, non-image payload, oversize),
    // and insertAssetFromUrl can throw on network errors — neither may
    // dead-end the slot or abort the whole pass: exclude that provider and
    // try the next, bounded by the provider count. (2026-11-09 staging:
    // picsum probes passed but downloads failed after the probe, the
    // remaining providers were never tried, and runs shipped 2/3 photos.)
    const downloadViaProviders = async (
      kw: string,
      nameHint: string,
    ): Promise<{ resolved: ResolvedImage; saved: InsertAssetResult; sitePath: string; hash: string | null } | null> => {
      const excluded = new Set<string>();
      for (let round = 0; round < 4 && !overallSignal.aborted; round++) {
        const resolved = await resolveSlotImage(kw, seed + round, overallSignal, providerAttempts, excluded);
        if (!resolved) return null;
        let saved: InsertAssetResult | null = null;
        try {
          saved = await insertAssetFromUrl(resolved.url, { nameHint, signal: overallSignal }, transport);
        } catch {
          saved = null;
        }
        if (saved?.success && saved.sitePath) {
          return { resolved, saved, sitePath: saved.sitePath, hash: await contentHash(saved.sitePath) };
        }
        excluded.add(resolved.provider);
        seed += 1;
      }
      return null;
    };
    const resolve = async (keywords: string) => {
      if (overallSignal.aborted) return null;
      if (report.imagesResolved + report.imagesFailed >= budget) return null;
      // Dedupe: distinct keywords can still resolve to the same photo
      // (provider seed collisions shipped visibly duplicated gallery
      // images) — hash the saved bytes and retry once with a bumped seed
      // and varied keywords; a still-identical image counts as a failure
      // so the slot falls back to the honest placeholder.
      let attempt = await downloadViaProviders(keywords, keywords.slice(0, 30));
      let hash = attempt?.hash ?? null;
      if (hash && usedHashes.has(hash)) {
        seed += 1000;
        const varied = `${keywords} scene`;
        attempt = await downloadViaProviders(varied, varied.slice(0, 30));
        hash = attempt?.hash ?? null;
        if (hash && usedHashes.has(hash)) {
          seed += 1;
          report.imagesFailed += 1;
          return null;
        }
      }
      seed += 1;
      if (!attempt) {
        report.imagesFailed += 1;
        return null;
      }
      const { resolved, saved, sitePath } = attempt;
      if (hash) usedHashes.add(hash);
      report.imagesResolved += 1;
      if (!report.providersUsed.includes(resolved.provider)) {
        report.providersUsed.push(resolved.provider);
      }
      // Treat the just-materialized file as on-disk so the repair pass
      // below does not "fix" it as a missing relative ref.
      fileSet.add(sitePath.replace(/^\//, ""));
      if (saved.path) fileSet.add(saved.path.replace(/^\//, ""));
      trackSize(sitePath, saved.path, saved.sizeBytes);
      return sitePath;
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

      // 3. Repair broken / external / placeholder refs — <img src> AND
      // CSS url() (inline background-image, <style> blocks). The golden
      // 41962554092 run shipped three hallucinated Unsplash photo-ids as
      // CSS background url()s: extractImageRefs already audits them, but
      // only img-kind refs were repaired, so the dead hotlinks went live.
      const refs = extractImageRefs(html).filter(
        (r) => (r.kind === "img" && r.src) || (r.kind === "css" && r.src),
      );
      for (const ref of refs) {
        const src = ref.src;
        const isExternal = /^https?:\/\//i.test(src);
        const isPlaceholder = /via\.placeholder|placehold\.|dummyimage|fakeimg/i.test(src);
        // CSS url() is not image-only space: @font-face srcs, SVG paint
        // servers (url(#id)) and other resources share the syntax. Only
        // refs that are actually image-shaped get the image pipeline —
        // everything else is left exactly as authored.
        const isImageRef =
          ref.kind === "img" ||
          /\.(png|jpe?g|webp|gif|avif|bmp|ico|svg)(\?|#|$)/i.test(src) ||
          /unsplash|pexels|picsum|pixabay|pollinations|loremflickr|placehold|dummyimage|fakeimg|images?\/|img\//i.test(src);
        if (ref.kind === "css" && (!isImageRef || src.startsWith("#"))) continue;
        const relMissing =
          !isExternal &&
          !/^(data:|blob:)/i.test(src) &&
          !fileSet.has(src.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0]) &&
          !fileSet.has(`public/${src.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0]}`);
        // The rewrite differs by kind: an <img> carries src="…" inside the
        // matched tag (SRC_ATTR_RE), a css url() is just the bare URL —
        // replacing the src substring preserves the original quoting.
        const rewrite = (nextSrc: string) =>
          ref.kind === "img"
            ? ref.raw.replace(SRC_ATTR_RE, `$1${nextSrc}$3`)
            : ref.raw.replace(src, nextSrc);
        if (isExternal && !isPlaceholder) {
          // Rehost the hotlink into the project — persists in deploys.
          const saved = await insertAssetFromUrl(src, { nameHint: "external-image" }, transport)
            .catch(() => null);
          if (saved?.success && saved.sitePath) {
            html = html.replace(ref.raw, rewrite(saved.sitePath));
            changed = true;
            fileSet.add(saved.sitePath.replace(/^\//, ""));
            if (saved.path) fileSet.add(saved.path.replace(/^\//, ""));
            trackSize(saved.sitePath, saved.path, saved.sizeBytes);
            if (!report.providersUsed.includes("external-rehost")) report.providersUsed.push("external-rehost");
          } else {
            // The hotlink is unreachable, forged, or non-image — a broken
            // external URL must never ship (golden 41948852260). Replace
            // it through the authorized stock chain, or fall back to the
            // honest local placeholder; the original src is always removed.
            report.imagesFailed += 1;
            const alt = ref.raw.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
            const sitePath = await resolve(alt || topic);
            const finalSrc = sitePath ?? (await ensurePlaceholderSvg(transport));
            if (!finalSrc) continue;
            if (!sitePath) {
              report.placeholdersUsed += 1;
              fileSet.add(PLACEHOLDER_SVG_PATH);
            }
            html = html.replace(ref.raw, rewrite(finalSrc));
            changed = true;
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
          html = html.replace(ref.raw, rewrite(finalSrc));
          changed = true;
        }
      }

      if (changed) {
        await transport.writeFile(file, html);
        report.filesChanged.push(file);
      }
    }

    // 4. Real-photo floor. The deployed entry page is what acceptance
    // measures: a landing page with fewer than MIN_REAL_PHOTOS verifiable
    // photos is a failed visual build regardless of how tidy the markup
    // is. When the floor is short, append a small self-styled gallery of
    // provider-resolved images — on-topic (keywords come from the page's
    // own <title>/<h1>), real bytes persisted in the workspace. Images
    // that fail to resolve are honestly not faked; the post-audit then
    // still reports what actually shipped.
    const entry = htmlFiles.find((f) => /^index\.html?$/i.test(f)) ?? htmlFiles[0];
    {
      const { content: entryHtml } = await transport.readFile(entry);
      const countPhotos = (html: string) => {
        const seen = new Set<string>();
        for (const r of extractImageRefs(html)) {
          const src = r.src?.trim() ?? "";
          if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
          const rel = src.replace(/^\.\//, "").replace(/^\//, "").split(/[?#]/)[0];
          if (!rel || /\.svg$/i.test(rel) || smallImages.has(rel)) continue;
          if (fileSet.has(rel) || fileSet.has(`public/${rel}`)) seen.add(rel);
        }
        return seen.size;
      };
      let html = entryHtml;
      const needed = MIN_REAL_PHOTOS - countPhotos(html);
      if (needed > 0) {
        const title = html.match(/<title[^>]*>([^<]{3,120})<\/title>/i)?.[1] ?? "";
        const h1 = html.match(/<h1[^>]*>([^<]{3,120})<\/h1>/i)?.[1] ?? "";
        const base = `${title} ${h1}`.trim() || topic;
        const vary = ["", " detail", " texture", " interior"];
        const imgs: string[] = [];
        // A single failed resolve must not starve the floor: providers are
        // free-tier and flake, so keep trying with rotated keywords — the
        // shared image budget still bounds total work, and a null resolve
        // already counted itself against it.
        let floorAttempts = 0;
        const maxFloorAttempts = needed * 2;
        for (let i = 0; i < needed && floorAttempts < maxFloorAttempts && !overallSignal.aborted; ) {
          floorAttempts += 1;
          const sitePath = await resolve(`${base}${vary[i % vary.length]}`.trim());
          if (!sitePath) continue;
          const alt = `${title || h1 || "Site"} — photo ${i + 1}`.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          imgs.push(`<img src="${sitePath}" alt="${alt}" style="width:100%;height:220px;object-fit:cover;border-radius:12px;display:block;" loading="lazy">`);
          i += 1;
        }
        if (imgs.length > 0) {
          const section =
            `<section class="litt-gallery" aria-label="Gallery" style="padding:64px 24px;max-width:1100px;margin:0 auto;">` +
            `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">` +
            imgs.join("") +
            `</div></section>`;
          // Above the footer when one exists — a trailing photo grid reads
          // as content; after the footer it reads as a rendering bug.
          html = /<footer[\s>]/i.test(html)
            ? html.replace(/<footer[\s>]/i, (m) => `${section}${m}`)
            : /<\/body>/i.test(html)
              ? html.replace(/<\/body>/i, `${section}</body>`)
              : html + section;
          await transport.writeFile(entry, html);
          if (!report.filesChanged.includes(entry)) report.filesChanged.push(entry);
        }
      }
    }

    // Surface which provider lanes failed (or were never configured) —
    // run evidence must name the failing lane, not just the count.
    const seenFailed = new Set<string>();
    for (const a of providerAttempts) {
      if (a.status === "resolved") continue;
      const label = a.status === "unconfigured" ? `${a.provider}(unconfigured)` : a.provider;
      if (!seenFailed.has(label)) {
        seenFailed.add(label);
        report.providersFailed.push(label);
      }
    }

    // Final audit of the primary entry file after rewriting.
    const { content: finalHtml } = await transport.readFile(entry);
    const postFiles = new Set(fileSet);
    for (const p of report.filesChanged) postFiles.add(p);
    const assets = await transport.listFiles("assets/images").catch(() => null);
    for (const e of assets?.entries ?? []) if (e.type === "file") postFiles.add(`assets/images/${e.name}`);
    report.audit = auditStaticSiteHtml(finalHtml, postFiles);
    return report;
  } catch (err) {
    console.warn("[enrich] enrichStaticSiteVisuals aborted:", err instanceof Error ? err.message : err);
    return report;
  }
}
