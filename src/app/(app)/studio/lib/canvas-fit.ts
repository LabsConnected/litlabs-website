export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Scale a source rectangle down until it fits inside a definite box.
 *
 * The source is never enlarged: image canvases already have a natural or
 * bitmap size, and silently upscaling them would blur the preview while
 * making the fitted box harder to reason about. Invalid or unmeasured
 * boxes return a zero size so callers can keep their CSS fallback until
 * the stage has been measured.
 */
export function fitWithinBox(
  source: CanvasSize,
  box: CanvasSize,
  maxWidth = Number.POSITIVE_INFINITY,
): CanvasSize {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    box.width <= 0 ||
    box.height <= 0 ||
    maxWidth <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(
    1,
    box.width / source.width,
    box.height / source.height,
    maxWidth / source.width,
  );

  return {
    width: Math.max(1, Math.floor(source.width * scale + 1e-6)),
    height: Math.max(1, Math.floor(source.height * scale + 1e-6)),
  };
}
