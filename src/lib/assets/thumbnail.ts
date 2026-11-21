/**
 * Asset Lake — grid thumbnail source resolution.
 *
 * Why this exists (2026-11-20 diagnosis): generated assets almost never
 * carry a real thumbnailUrl — no image provider populates one, and the
 * generation completion write only persisted durableUrl into the job
 * metadata. Both Media panels therefore rendered every grid cell with
 * the FULL-resolution original (multi-MB PNGs), so a first Media load
 * downloaded every original in the project before the grid looked
 * loaded — minutes on a home connection for a 14-item project.
 *
 * Resolution order:
 *   1. A real thumbnailUrl when the asset carries one.
 *   2. The Next.js image optimizer at a small width, when the URL is
 *      one the optimizer is configured to serve (local paths, or a
 *      host listed in images.remotePatterns in next.config.ts). The
 *      optimizer downscales server-side and caches the result, so the
 *      browser gets tens of KB instead of the full original.
 *   3. The original URL unchanged — data:/blob: URLs and hosts the
 *      optimizer would reject pass through exactly as before (no
 *      regression for unconfigured storage domains).
 *
 * Keep OPTIMIZER_HOST_MATCHERS in sync with images.remotePatterns in
 * next.config.ts: the optimizer endpoint returns 400 for any host not
 * listed there, so sending it an unlisted host would break the image.
 */

import type { StudioAsset } from "./types";

/** Width the Media grids ask the optimizer for (cells render ≤ ~300px). */
export const MEDIA_THUMB_WIDTH = 384;
export const MEDIA_THUMB_QUALITY = 60;

type HostMatcher = (hostname: string) => boolean;

const suffix =
  (domain: string): HostMatcher =>
  (hostname) =>
    hostname === domain || hostname.endsWith(`.${domain}`);

const exact =
  (host: string): HostMatcher =>
  (hostname) =>
    hostname === host;

/** Mirrors images.remotePatterns in next.config.ts. */
const OPTIMIZER_HOST_MATCHERS: HostMatcher[] = [
  suffix("supabase.co"),
  exact("images.unsplash.com"),
  exact("image.pollinations.ai"),
  exact("img.youtube.com"),
  exact("img.clerk.com"),
  exact("images.clerk.dev"),
  suffix("r2.cloudflarestorage.com"),
  suffix("r2.dev"),
  suffix("googleusercontent.com"),
  exact("avatars.githubusercontent.com"),
  exact("thumbnails.libretro.com"),
];

function isOptimizerHost(hostname: string): boolean {
  return OPTIMIZER_HOST_MATCHERS.some((match) => match(hostname));
}

function optimizerUrl(source: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=${MEDIA_THUMB_QUALITY}`;
}

/**
 * Best grid-thumbnail src for an asset. Detail/viewer surfaces must
 * keep using asset.url directly — this is for small grid cells only.
 */
export function mediaThumbnailSrc(
  asset: Pick<StudioAsset, "url" | "thumbnailUrl">,
  width: number = MEDIA_THUMB_WIDTH,
): string {
  if (asset.thumbnailUrl) return asset.thumbnailUrl;

  const url = asset.url;
  if (!url) return url;

  // Local paths are always servable by the optimizer.
  if (url.startsWith("/") && !url.startsWith("//")) {
    return optimizerUrl(url, width);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  // data:/blob: and anything non-HTTP(S) passes through untouched.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return url;
  }

  if (!isOptimizerHost(parsed.hostname)) return url;
  return optimizerUrl(url, width);
}
