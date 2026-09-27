/**
 * image-ops — the pure half of the Studio image editor.
 *
 * The editor keeps an ops list (crop → rotate/flip → filters → resize)
 * and re-renders the source image through it on every change. Undo/redo
 * is an op-stack, never destructive: the source pixels are never touched
 * until "Save" exports a real PNG into the workspace or asset lake.
 *
 * Kept free of DOM canvas calls so the geometry, filtering, and history
 * logic is unit-testable in jsdom (where getContext("2d") is null).
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface ImageFilters {
  /** 100 = unchanged. Range 0–200. */
  brightness: number;
  contrast: number;
  saturate: number;
  /** 0–100 strength. */
  grayscale: number;
  sepia: number;
  /** px. 0 = off, capped for sanity. */
  blur: number;
}

export interface ImageOps {
  crop: CropRect | null;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  /** Explicit output size; null = cropped/rotated size. */
  resize: { w: number; h: number } | null;
  filters: ImageFilters;
}

export function defaultOps(): ImageOps {
  return {
    crop: null,
    rotate: 0,
    flipH: false,
    flipV: false,
    resize: null,
    filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0 },
  };
}

/** Clamp a crop rect inside the source bounds; null if degenerate. */
export function clampCrop(crop: CropRect, srcW: number, srcH: number): CropRect | null {
  const x = Math.max(0, Math.min(crop.x, srcW));
  const y = Math.max(0, Math.min(crop.y, srcH));
  const w = Math.max(0, Math.min(crop.w, srcW - x));
  const h = Math.max(0, Math.min(crop.h, srcH - y));
  if (w < 2 || h < 2) return null;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Output dimensions after crop+rotate (+ explicit resize). */
export function outputSize(ops: ImageOps, srcW: number, srcH: number): { w: number; h: number } {
  const cropped = ops.crop ? { w: ops.crop.w, h: ops.crop.h } : { w: srcW, h: srcH };
  const rotated = ops.rotate === 90 || ops.rotate === 270
    ? { w: cropped.h, h: cropped.w }
    : cropped;
  if (ops.resize) {
    return { w: Math.max(1, Math.round(ops.resize.w)), h: Math.max(1, Math.round(ops.resize.h)) };
  }
  return rotated;
}

/** CSS filter string for ctx.filter / CSS filter on the preview. */
export function filterString(f: ImageFilters): string {
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia}%)`);
  if (f.blur > 0) parts.push(`blur(${Math.min(f.blur, 40)}px)`);
  return parts.join(" ");
}

export function opsAreIdentity(ops: ImageOps): boolean {
  return !ops.crop
    && ops.rotate === 0
    && !ops.flipH
    && !ops.flipV
    && !ops.resize
    && ops.filters.brightness === 100
    && ops.filters.contrast === 100
    && ops.filters.saturate === 100
    && ops.filters.grayscale === 0
    && ops.filters.sepia === 0
    && ops.filters.blur === 0;
}

/** Proportional resize helper — width edit keeps aspect when locked. */
export function resizeKeepingAspect(
  base: { w: number; h: number },
  axis: "w" | "h",
  value: number,
): { w: number; h: number } {
  if (value <= 0 || base.w <= 0 || base.h <= 0) return base;
  return axis === "w"
    ? { w: Math.round(value), h: Math.max(1, Math.round((value / base.w) * base.h)) }
    : { h: Math.round(value), w: Math.max(1, Math.round((value / base.h) * base.w)) };
}

// ── op-history ───────────────────────────────────────────────────────

export interface OpHistory {
  stack: ImageOps[];
  index: number;
}

export function pushOp(history: OpHistory, ops: ImageOps, limit = 60): OpHistory {
  const stack = [...history.stack.slice(0, history.index + 1), ops].slice(-limit);
  return { stack, index: stack.length - 1 };
}

export function canUndo(h: OpHistory): boolean {
  return h.index > 0;
}

export function canRedo(h: OpHistory): boolean {
  return h.index < h.stack.length - 1;
}

export function undoOp(h: OpHistory): OpHistory {
  return canUndo(h) ? { ...h, index: h.index - 1 } : h;
}

export function redoOp(h: OpHistory): OpHistory {
  return canRedo(h) ? { ...h, index: h.index + 1 } : h;
}

export function currentOps(h: OpHistory): ImageOps {
  return h.stack[h.index] ?? defaultOps();
}

// ── canvas render (browser only — not part of the testable core) ─────

/**
 * Render source image through ops onto a fresh canvas and return it.
 * Order: crop (source rect) → rotate/flip (transform) → filters → resize
 * (output canvas dimensions). Caller decides preview vs export scale.
 */
export function renderOpsToCanvas(
  image: CanvasImageSource & { width: number; height: number },
  ops: ImageOps,
): HTMLCanvasElement | null {
  const src = ops.crop ?? { x: 0, y: 0, w: image.width, h: image.height };
  const quarter = ops.rotate === 90 || ops.rotate === 270;
  const iw = quarter ? src.h : src.w;
  const ih = quarter ? src.w : src.h;

  // Pass 1 — crop + rotate + flip at native resolution.
  const inter = document.createElement("canvas");
  inter.width = iw;
  inter.height = ih;
  const ictx = inter.getContext("2d");
  if (!ictx) return null;
  ictx.save();
  ictx.translate(iw / 2, ih / 2);
  ictx.rotate((ops.rotate * Math.PI) / 180);
  ictx.scale(ops.flipH ? -1 : 1, ops.flipV ? -1 : 1);
  ictx.drawImage(image, src.x, src.y, src.w, src.h, -src.w / 2, -src.h / 2, src.w, src.h);
  ictx.restore();

  // Pass 2 — filters + resize to the output canvas.
  const { w, h } = outputSize(ops, image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const filter = filterString(ops.filters);
  if (filter) ctx.filter = filter;
  ctx.drawImage(inter, 0, 0, iw, ih, 0, 0, w, h);
  return canvas;
}
