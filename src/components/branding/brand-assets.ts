/**
 * LiTTree LabStudios brand assets — single source of truth.
 *
 * Current lockup (added 2026-09-24 in #489, `feat(branding): update
 * LiTTree LabStudios logo`):
 *   public/branding/littree-labstudios-logo.png
 *     Horizontal crystal-tree + "LiTTree LabStudios" wordmark, 2172×724,
 *     with transparent padding around the artwork.
 * Compact mark (same crystal, used by the app icons and favicons):
 *   public/branding/littree-crystal-mark.png
 *     256×256. public/icon-192.png, public/icon-512.png, and
 *     src/app/icon.png are raster copies of this mark.
 *
 * UI renders the tight crops below so a normal in-flow image shows the
 * artwork. Do not crop these again with absolute positioning — a
 * width:100% frame around an out-of-flow image collapses to 0×0.
 *   public/branding/littree-labstudios-wordmark.png  (1826×420)
 *   public/branding/littree-crystal-mark-display.png (220×220)
 *
 * Retired, do not reference from product UI:
 *   public/logo-littree.svg  — July 2026 circuit-tree
 *   public/logo.png          — geometric "L" on black
 *   public/logo.webp         — same geometric "L"
 */

export const BRAND_WORDMARK_SRC = "/branding/littree-labstudios-wordmark.png";
export const BRAND_WORDMARK_SIZE = { width: 1826, height: 420 } as const;

export const BRAND_MARK_SRC = "/branding/littree-crystal-mark-display.png";
export const BRAND_MARK_SIZE = { width: 220, height: 220 } as const;

/** 512px app icon of the crystal mark (JSON-LD, large PWA icon). */
export const BRAND_APP_ICON_SRC = "/icon-512.png";
/** 192px app icon of the crystal mark (manifest shortcuts, notifications). */
export const BRAND_APP_ICON_192_SRC = "/icon-192.png";

/** Display width for a fixed-height rendering of an intrinsic asset. */
export function brandDisplayWidth(
  intrinsic: { width: number; height: number },
  height: number,
) {
  return Math.round(height * (intrinsic.width / intrinsic.height));
}
