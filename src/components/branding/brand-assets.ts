/**
 * LiTTree LabStudios brand assets — single source of truth.
 *
 * Current lockup (added 2026-09-24 in #489, `feat(branding): update
 * LiTTree LabStudios logo`):
 *   public/branding/littree-labstudios-logo.png
 *     Horizontal crystal-tree + "LiTTree LabStudios" wordmark, 2172×724.
 * Compact mark (same crystal, used by the app icons and favicons):
 *   public/branding/littree-crystal-mark.png
 *     256×256. public/icon-192.png, public/icon-512.png, and
 *     src/app/icon.png are raster copies of this mark.
 *
 * Retired, do not reference from product UI:
 *   public/logo-littree.svg  — July 2026 circuit-tree
 *   public/logo.png          — geometric "L" on black
 *   public/logo.webp         — same geometric "L"
 *
 * The PNG canvases include transparent padding. Frames below are the
 * opaque content boxes so headers render the artwork, not the padding.
 */

export const BRAND_WORDMARK_SRC = "/branding/littree-labstudios-logo.png";
export const BRAND_MARK_SRC = "/branding/littree-crystal-mark.png";
/** 512px app icon of the crystal mark (JSON-LD, large PWA icon). */
export const BRAND_APP_ICON_SRC = "/icon-512.png";
/** 192px app icon of the crystal mark (manifest shortcuts, notifications). */
export const BRAND_APP_ICON_192_SRC = "/icon-192.png";

export type BrandFrame = {
  width: number;
  height: number;
  content: { x: number; y: number; width: number; height: number };
};

/** Opaque content inside the 2172×724 wordmark canvas. */
export const BRAND_WORDMARK_FRAME: BrandFrame = {
  width: 2172,
  height: 724,
  content: { x: 184, y: 146, width: 1826, height: 420 },
};

/** Opaque content inside the 256×256 crystal mark, kept square. */
export const BRAND_MARK_FRAME: BrandFrame = {
  width: 256,
  height: 256,
  content: { x: 22, y: 26, width: 220, height: 220 },
};

export function brandFrameDisplaySize(frame: BrandFrame, height: number) {
  const aspect = frame.content.width / frame.content.height;
  const displayW = Math.round(height * aspect);
  const displayH = height;
  const scale = displayW / frame.content.width;
  return {
    displayW,
    displayH,
    imgW: frame.width * scale,
    imgH: frame.height * scale,
    offsetX: -frame.content.x * scale,
    offsetY: -frame.content.y * scale,
  };
}
