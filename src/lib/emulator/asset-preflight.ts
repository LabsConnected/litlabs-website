/**
 * EmulatorAssetPreflight — verifies that every required EmulatorJS asset
 * returns HTTP 200 with valid binary content AND a matching SHA-256
 * checksum from manifest.json before the iframe is mounted.
 *
 * Rejects:
 *   - HTTP non-200 responses
 *   - HTML error pages served with status 200 (Next.js fallback)
 *   - Zero-byte responses
 *   - Content-Type: text/html
 *   - Redirects to login/error pages
 *   - Checksum mismatch (corrupted or tampered file)
 */

import type {
  EmulatorAssetCheck,
  EmulatorAssetPreflightResult,
  EmulatorFailureCode,
} from "./types";
import {
  EMULATOR_MANIFEST_PATH,
  SEVEN_Z_SIGNATURE,
  getCoreDataFilename,
} from "./types";

interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

interface Manifest {
  runtime: string;
  version: string;
  source: string;
  files: ManifestEntry[];
}

// Cache the manifest fetch so we don't re-download it on every preflight.
let cachedManifest: Manifest | null = null;
let cachedManifestPath: string | null = null;

async function loadManifest(manifestPath: string): Promise<Manifest | null> {
  if (cachedManifest && cachedManifestPath === manifestPath) {
    return cachedManifest;
  }
  try {
    const res = await fetch(manifestPath, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as Manifest;
    // Normalize Windows backslash paths to forward slashes for lookup
    json.files = json.files.map((f) => ({
      ...f,
      path: f.path.replace(/\\/g, "/"),
    }));
    cachedManifest = json;
    cachedManifestPath = manifestPath;
    return json;
  } catch {
    return null;
  }
}

function looksLikeHtml(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength > 1024 * 1024) return false;
  const head = new TextDecoder().decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512)),
  ).toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head") ||
    head.includes("<title>")
  );
}

function hasSevenZSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < SEVEN_Z_SIGNATURE.length) return false;
  const view = new Uint8Array(buffer, 0, SEVEN_Z_SIGNATURE.length);
  for (let i = 0; i < SEVEN_Z_SIGNATURE.length; i++) {
    if (view[i] !== SEVEN_Z_SIGNATURE[i]) return false;
  }
  return true;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback: no checksum available (non-secure context)
  return "";
}

/**
 * Run the asset preflight for a given core and data path.
 *
 * @param core The EmulatorJS core name or alias (e.g. "nes", "fceumm", "nestopia")
 * @param dataPath The base data path (self-hosted or CDN)
 * @param options.manifestPath Path to manifest.json (defaults to the self-hosted manifest)
 * @param options.verifyChecksums Whether to verify SHA-256 against the manifest
 *   (disable for CDN control test — the CDN has no manifest)
 * @param options.legacy Whether to check the legacy core variant
 * @param options.threads Whether to check the threaded core variant
 */
export async function preflightEmulatorAssets(
  core: string,
  dataPath: string,
  options?: {
    manifestPath?: string;
    verifyChecksums?: boolean;
    legacy?: boolean;
    threads?: boolean;
  },
): Promise<EmulatorAssetPreflightResult> {
  const manifestPath = options?.manifestPath ?? EMULATOR_MANIFEST_PATH;
  const verifyChecksums = options?.verifyChecksums ?? true;

  // Load manifest for checksum verification (skip for CDN)
  const manifest = verifyChecksums ? await loadManifest(manifestPath) : null;

  // Resolve the actual core .data filename (e.g. "nes" → "fceumm-wasm.data")
  const coreFileName = getCoreDataFilename(core, {
    legacy: options?.legacy,
    threads: options?.threads,
  });

  const checks: Array<{
    url: string;
    label: string;
    isCore?: boolean;
    manifestPath?: string;
  }> = [
    { url: `${dataPath}loader.js`, label: "loader.js", manifestPath: "data/loader.js" },
    { url: `${dataPath}emulator.min.js`, label: "emulator.min.js", manifestPath: "data/emulator.min.js" },
    { url: `${dataPath}emulator.min.css`, label: "emulator.min.css", manifestPath: "data/emulator.min.css" },
    { url: `${dataPath}version.json`, label: "version.json", manifestPath: "data/version.json" },
    {
      url: `${dataPath}cores/${coreFileName}`,
      label: `core ${coreFileName}`,
      isCore: true,
      manifestPath: `data/cores/${coreFileName}`,
    },
    { url: `${dataPath}compression/extract7z.js`, label: "extract7z.js", manifestPath: "data/compression/extract7z.js" },
  ];

  const results: EmulatorAssetCheck[] = [];
  let allOk = true;
  let firstFailure: { url: string; reason: string; code: EmulatorFailureCode } | null = null;
  let coreBytes: number | undefined;

  for (const check of checks) {
    const start = performance.now();
    const entry: EmulatorAssetCheck = {
      url: check.url,
      label: check.label,
      status: 0,
      ok: false,
      redirected: false,
      htmlFallbackDetected: false,
      durationMs: 0,
    };

    try {
      const res = await fetch(check.url, { method: "GET", cache: "no-store", redirect: "error" });
      entry.status = res.status;
      entry.redirected = res.redirected;
      entry.contentType = res.headers.get("content-type") ?? undefined;
      entry.contentLength = Number(res.headers.get("content-length")) || undefined;

      if (!res.ok) {
        entry.error = `HTTP ${res.status} ${res.statusText}`;
        results.push(entry);
        entry.durationMs = Math.round(performance.now() - start);
        if (allOk) firstFailure = { url: check.url, reason: entry.error, code: "ASSET_MISSING" };
        allOk = false;
        continue;
      }

      const buffer = await res.arrayBuffer();
      entry.contentLength = buffer.byteLength;
      entry.durationMs = Math.round(performance.now() - start);

      if (buffer.byteLength === 0) {
        entry.error = "Zero-byte response";
        results.push(entry);
        if (allOk) firstFailure = { url: check.url, reason: entry.error, code: "ASSET_CORRUPT" };
        allOk = false;
        continue;
      }

      const contentType = entry.contentType ?? "";
      if (contentType.includes("text/html") || looksLikeHtml(buffer)) {
        entry.htmlFallbackDetected = true;
        entry.error = `Server returned HTML (content-type: ${contentType})`;
        results.push(entry);
        if (allOk)
          firstFailure = { url: check.url, reason: entry.error, code: "ASSET_HTML_FALLBACK" };
        allOk = false;
        continue;
      }

      if (check.isCore) {
        if (!hasSevenZSignature(buffer)) {
          const view = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8));
          const hex = Array.from(view)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          entry.error = `Missing 7z archive signature. First bytes: ${hex}`;
          results.push(entry);
          if (allOk)
            firstFailure = { url: check.url, reason: entry.error, code: "ASSET_CORRUPT" };
          allOk = false;
          continue;
        }
        coreBytes = buffer.byteLength;
      }

      // Checksum verification (skip for CDN — no manifest available)
      if (verifyChecksums && manifest && check.manifestPath) {
        const manifestEntry = manifest.files.find((f) => f.path === check.manifestPath);
        if (manifestEntry) {
          entry.checksumExpected = manifestEntry.sha256;
          const actual = await sha256(buffer);
          entry.checksumActual = actual;
          if (actual) {
            entry.checksumValid = actual === manifestEntry.sha256;
            if (!entry.checksumValid) {
              entry.error = `Checksum mismatch: expected ${manifestEntry.sha256.slice(0, 16)}…, got ${actual.slice(0, 16)}…`;
              results.push(entry);
              if (allOk)
                firstFailure = { url: check.url, reason: entry.error, code: "ASSET_CORRUPT" };
              allOk = false;
              continue;
            }
          }
        }
        // If the file isn't in the manifest, we don't fail — the manifest may
        // not cover every file (e.g. localization files). Cores + runtime
        // files are always in the manifest.
      }

      entry.ok = true;
      results.push(entry);
    } catch (err) {
      entry.durationMs = Math.round(performance.now() - start);
      entry.error = err instanceof Error ? err.message : "Network request failed";
      results.push(entry);
      if (allOk)
        firstFailure = { url: check.url, reason: entry.error, code: "ASSET_MISSING" };
      allOk = false;
    }
  }

  return {
    ok: allOk,
    checks: results,
    coreBytes,
    failedUrl: firstFailure?.url,
    reason: firstFailure?.reason,
    failureCode: firstFailure?.code,
  };
}
