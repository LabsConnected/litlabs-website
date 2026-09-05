import { createHash } from "crypto";
import { lookup } from "dns/promises";
import net from "net";
import { AssetInspectionSchema, type AssetInspection } from "./types";

export const DEFAULT_VISUAL_ASSET_ALLOWLIST = [
  "api.pexels.com",
  "images.pexels.com",
  "images.unsplash.com",
  "plus.unsplash.com",
  "source.unsplash.com",
  "image.pollinations.ai",
  "queue.fal.run",
  "fal.run",
  "generativelanguage.googleapis.com",
] as const;

export interface AssetFetchOptions {
  allowedHosts?: string[];
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface InspectAssetOptions extends AssetFetchOptions {
  minimumWidth?: number;
  minimumHeight?: number;
  targetAspectRatio?: number | null;
  seenChecksums?: Set<string>;
}

export interface DownloadedAsset {
  url: string;
  contentType: string;
  bytes: Buffer;
  statusCode: number;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  }

  return false;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isPrivateIpLiteral(host: string): boolean {
  if (net.isIP(host) === 0) return false;
  if (host === "127.0.0.1" || host === "::1") return true;
  if (net.isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = host.toLowerCase();
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function hostMatches(hostname: string, allowedHosts: string[]): boolean {
  const host = normalizeHost(hostname);
  return allowedHosts.some((entry) => {
    const normalized = normalizeHost(entry.replace(/^\*\./, ""));
    if (entry.startsWith("*.") && host.endsWith(`.${normalized}`)) return true;
    return host === normalized;
  });
}

async function assertHostDoesNotResolvePrivateIp(hostname: string) {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("localhost URLs are not allowed");
  }

  const resolved = await lookup(host, { all: true }).catch(() => [] as Array<{ address: string }>);
  for (const record of resolved) {
    if (isPrivateIp(record.address)) {
      throw new Error(`Host resolves to a private IP range: ${record.address}`);
    }
  }
}

export function validateAssetUrl(url: string, allowedHosts: string[] = []): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid asset URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS asset URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Credentials in asset URLs are not allowed");
  }

  const host = normalizeHost(parsed.hostname);
  const metadataHosts = new Set(["169.254.169.254", "metadata.google.internal", "metadata.azure.internal"]);
  if (metadataHosts.has(host)) {
    throw new Error("Metadata endpoints are not allowed");
  }

  if (host === "localhost" || host.endsWith(".localhost") || isPrivateIpLiteral(host)) {
    throw new Error("Localhost or private-network asset URLs are not allowed");
  }

  if (allowedHosts.length === 0) {
    throw new Error("An approved asset allowlist is required");
  }

  if (!hostMatches(host, allowedHosts)) {
    throw new Error(`Host is not on the approved asset allowlist: ${host}`);
  }

  return parsed;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Asset exceeds maximum download size of ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks, total);
}

async function fetchAssetWithSecurity(
  url: string,
  options: AssetFetchOptions,
  redirectCount = 0,
): Promise<DownloadedAsset> {
  const allowedHosts = options.allowedHosts ?? [];
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const parsed = validateAssetUrl(url, allowedHosts);
  await assertHostDoesNotResolvePrivateIp(parsed.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "image/*,*/*;q=0.2" },
    });

    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= maxRedirects) {
        throw new Error("Too many redirects while fetching asset");
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect response missing location header");
      }
      const nextUrl = new URL(location, parsed).toString();
      return fetchAssetWithSecurity(nextUrl, options, redirectCount + 1);
    }

    const statusCode = response.status;
    if (!response.ok) {
      return {
        url: parsed.toString(),
        contentType: response.headers.get("content-type") || "",
        bytes: Buffer.alloc(0),
        statusCode,
      };
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > 0 && contentLength > maxBytes) {
      throw new Error(`Asset exceeds maximum download size of ${maxBytes} bytes`);
    }

    const bytes = await readResponseBody(response, maxBytes);
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

    return {
      url: parsed.toString(),
      contentType,
      bytes,
      statusCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function qualityFromInspection(args: {
  statusCode: number;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  minimumWidth: number;
  minimumHeight: number;
  targetAspectRatio?: number | null;
  hasAlpha: boolean | null;
  animated: boolean;
  duplicate: boolean;
  checksum: string;
}): AssetInspection {
  const rejectionReasons: string[] = [];
  const contentType = args.contentType || "";
  const imageLike = contentType.startsWith("image/");
  const htmlLike = contentType.includes("text/html") || contentType.includes("application/xhtml");

  if (args.statusCode < 200 || args.statusCode >= 300) {
    rejectionReasons.push(`HTTP ${args.statusCode}`);
  }
  if (!imageLike || htmlLike) {
    rejectionReasons.push(`Unsupported content type: ${contentType || "unknown"}`);
  }
  if (args.bytes <= 0) {
    rejectionReasons.push("Zero-byte asset");
  }
  if (args.width === null || args.height === null) {
    rejectionReasons.push("Could not decode image dimensions");
  }
  if (args.width !== null && args.width < args.minimumWidth) {
    rejectionReasons.push(`Width below minimum (${args.width} < ${args.minimumWidth})`);
  }
  if (args.height !== null && args.height < args.minimumHeight) {
    rejectionReasons.push(`Height below minimum (${args.height} < ${args.minimumHeight})`);
  }
  if (args.duplicate) {
    rejectionReasons.push("Duplicate asset checksum");
  }
  if (args.aspectRatio !== null && args.targetAspectRatio) {
    const ratioDelta = Math.abs(args.aspectRatio - args.targetAspectRatio) / args.targetAspectRatio;
    if (ratioDelta > 0.35) {
      rejectionReasons.push("Aspect ratio differs from the planned section");
    }
  }
  if (args.width && args.height) {
    const pixels = args.width * args.height;
    if (args.bytes < pixels * 0.04) {
      rejectionReasons.push("Extreme compression or unusually small file for the image dimensions");
    }
  }

  const invalid = rejectionReasons.length > 0;
  const weak = !invalid && (
    (args.width !== null && args.width < args.minimumWidth * 1.5) ||
    (args.height !== null && args.height < args.minimumHeight * 1.5)
  );

  return AssetInspectionSchema.parse({
    reachable: args.statusCode >= 200 && args.statusCode < 300,
    statusCode: args.statusCode,
    contentType,
    width: args.width,
    height: args.height,
    bytes: args.bytes,
    aspectRatio: args.aspectRatio,
    hasAlpha: args.hasAlpha,
    animated: args.animated,
    checksum: args.checksum,
    quality: invalid ? "invalid" : weak ? "weak" : "usable",
    rejectionReasons,
  });
}

export async function inspectAssetBuffer(
  bytes: Buffer,
  contentType: string,
  options: Omit<InspectAssetOptions, "allowedHosts" | "maxRedirects" | "maxBytes" | "timeoutMs"> & { statusCode?: number } = {},
): Promise<AssetInspection> {
  const checksum = createHash("sha256").update(bytes).digest("hex");

  if ((options.seenChecksums?.has(checksum) ?? false) || bytes.length === 0) {
    return qualityFromInspection({
      statusCode: options.statusCode ?? 200,
      contentType,
      bytes: bytes.length,
      width: null,
      height: null,
      aspectRatio: null,
      minimumWidth: options.minimumWidth ?? 1,
      minimumHeight: options.minimumHeight ?? 1,
      targetAspectRatio: options.targetAspectRatio ?? null,
      hasAlpha: null,
      animated: false,
      duplicate: options.seenChecksums?.has(checksum) ?? false,
      checksum,
    });
  }

  let metadata;
  try {
    // Loaded dynamically: sharp ships platform-specific native bindings that
    // aren't prebuilt for every architecture (e.g. Android/Termux arm64). A
    // static import throws at module-evaluation time on those platforms,
    // crashing every caller of this module even when they never inspect an
    // image. Deferring the import keeps that failure scoped to this call.
    const { default: sharp } = await import("sharp");
    metadata = await sharp(bytes).metadata();
  } catch {
    metadata = null;
  }

  const width = metadata?.width ?? null;
  const height = metadata?.height ?? null;
  const aspectRatio = width && height ? width / height : null;
  const hasAlpha = typeof metadata?.hasAlpha === "boolean" ? metadata.hasAlpha : null;
  const animated = Boolean(metadata?.pages && metadata.pages > 1);

  return qualityFromInspection({
    statusCode: options.statusCode ?? 200,
    contentType,
    bytes: bytes.length,
    width,
    height,
    aspectRatio,
    minimumWidth: options.minimumWidth ?? 1,
    minimumHeight: options.minimumHeight ?? 1,
    targetAspectRatio: options.targetAspectRatio ?? null,
    hasAlpha,
    animated,
    duplicate: options.seenChecksums?.has(checksum) ?? false,
    checksum,
  });
}

export async function inspectAsset(
  url: string,
  options: InspectAssetOptions = {},
): Promise<AssetInspection> {
  const downloaded = await fetchAssetWithSecurity(url, options);
  return inspectAssetBuffer(downloaded.bytes, downloaded.contentType, {
    minimumWidth: options.minimumWidth,
    minimumHeight: options.minimumHeight,
    targetAspectRatio: options.targetAspectRatio,
    seenChecksums: options.seenChecksums,
    statusCode: downloaded.statusCode,
  });
}

export async function downloadAssetBytes(
  url: string,
  options: AssetFetchOptions = {},
): Promise<DownloadedAsset> {
  return fetchAssetWithSecurity(url, options);
}

export function assetInspectionIsValid(inspection: AssetInspection): boolean {
  return inspection.quality !== "invalid" && inspection.rejectionReasons.length === 0;
}
