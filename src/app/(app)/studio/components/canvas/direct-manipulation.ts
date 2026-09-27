/**
 * Direct manipulation geometry for the Studio canvas.
 *
 * Pure helpers shared by the structured canvas, the preview overlay, and
 * tests. Pointer code feeds deltas in; this module returns the next box.
 * Style patches use the same inline-style keys the element inspector writes
 * (`width`, `height`, `left`, `top`, `position`) so a commit can go through
 * `applyElementPatch` / `useElementEdits` without a second patch shape.
 */

export const MIN_ELEMENT_SIZE = 16;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export const RESIZE_HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type GestureKind = "move" | ResizeHandle;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementStylePatch {
  styles: {
    position: "absolute";
    left: string;
    top: string;
    width: string;
    height: string;
  };
}

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
export type ArrowKey = (typeof ARROW_KEYS)[number];

export function isArrowKey(key: string): key is ArrowKey {
  return (ARROW_KEYS as readonly string[]).includes(key);
}

export function moveBox(start: Box, dx: number, dy: number): Box {
  return { x: start.x + dx, y: start.y + dy, width: start.width, height: start.height };
}

export function nudgeStep(shiftKey: boolean): number {
  return shiftKey ? 10 : 1;
}

export function nudgeBox(box: Box, key: ArrowKey, shiftKey: boolean): Box {
  const step = nudgeStep(shiftKey);
  switch (key) {
    case "ArrowUp":
      return moveBox(box, 0, -step);
    case "ArrowDown":
      return moveBox(box, 0, step);
    case "ArrowLeft":
      return moveBox(box, -step, 0);
    case "ArrowRight":
      return moveBox(box, step, 0);
    default:
      return box;
  }
}

function handleHas(handle: ResizeHandle, edge: "n" | "s" | "e" | "w"): boolean {
  return handle.includes(edge);
}

/**
 * Resize `start` by a pointer delta. `dx`/`dy` are totals from gesture
 * start, in the element's own coordinate space (already zoom-adjusted).
 * Shift locks the aspect ratio. Width and height never drop below `min`.
 */
export function resizeBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options?: { lockAspect?: boolean; min?: number },
): Box {
  const min = options?.min ?? MIN_ELEMENT_SIZE;
  const lock = options?.lockAspect ?? false;
  const aspect = start.width / Math.max(start.height, 1);
  const fromW = handleHas(handle, "w");
  const fromE = handleHas(handle, "e");
  const fromN = handleHas(handle, "n");
  const fromS = handleHas(handle, "s");

  let width = start.width;
  let height = start.height;
  if (fromE) width = start.width + dx;
  if (fromW) width = start.width - dx;
  if (fromS) height = start.height + dy;
  if (fromN) height = start.height - dy;

  if (lock && aspect > 0) {
    const horizontalOnly = handle === "e" || handle === "w";
    const verticalOnly = handle === "n" || handle === "s";
    if (horizontalOnly) height = width / aspect;
    else if (verticalOnly) width = height * aspect;
    else if (Math.abs(width - start.width) >= Math.abs((height - start.height) * aspect)) height = width / aspect;
    else width = height * aspect;
  }

  width = Math.max(min, width);
  height = Math.max(min, height);

  let x = fromW ? start.x + start.width - width : start.x;
  let y = fromN ? start.y + start.height - height : start.y;
  if (lock && (handle === "e" || handle === "w")) y = start.y + (start.height - height) / 2;
  if (lock && (handle === "n" || handle === "s")) x = start.x + (start.width - width) / 2;

  return { x, y, width, height };
}

export function applyGesture(start: Box, kind: GestureKind, dx: number, dy: number, shiftKey: boolean): Box {
  if (kind === "move") return moveBox(start, dx, dy);
  return resizeBox(start, kind, dx, dy, { lockAspect: shiftKey });
}

/** Inline styles the element inspector already understands. */
export function geometryToStylePatch(box: Box): ElementStylePatch {
  return {
    styles: {
      position: "absolute",
      left: `${Math.round(box.x)}px`,
      top: `${Math.round(box.y)}px`,
      width: `${Math.round(box.width)}px`,
      height: `${Math.round(box.height)}px`,
    },
  };
}

export function panBy(pan: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  return { x: pan.x + dx, y: pan.y + dy };
}

/** Wheel delta in CSS pixels of the canvas, after the current zoom. */
export function screenDeltaToCanvas(dx: number, dy: number, zoom: number): { dx: number; dy: number } {
  const z = zoom > 0 ? zoom : 1;
  return { dx: dx / z, dy: dy / z };
}

export function zoomByWheel(zoom: number, deltaY: number): number {
  const factor = deltaY > 0 ? 0.9 : 1.1;
  const next = zoom * factor;
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100;
}

/** Canvas-builder zoom is stored as a percent (25–200). */
export function zoomPercentByWheel(zoomPercent: number, deltaY: number): number {
  const factor = deltaY > 0 ? 0.9 : 1.1;
  return Math.round(Math.min(200, Math.max(25, zoomPercent * factor)));
}

export type CanvasKeyAction =
  | { type: "nudge"; dx: number; dy: number }
  | { type: "deselect" }
  | { type: "space" }
  | null;

/**
 * Keyboard contract for the canvas. Typing in inputs, textareas, selects,
 * or contenteditable regions produces no canvas action.
 */
export function canvasKeyAction(
  event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; code?: string },
  target: EventTarget | null,
): CanvasKeyAction {
  if (isTypingTarget(target)) return null;
  if (event.key === " " || event.key === "Spacebar" || event.code === "Space") return { type: "space" };
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "Escape") return { type: "deselect" };
  if (!isArrowKey(event.key)) return null;
  const step = nudgeStep(event.shiftKey);
  switch (event.key) {
    case "ArrowUp":
      return { type: "nudge", dx: 0, dy: -step };
    case "ArrowDown":
      return { type: "nudge", dx: 0, dy: step };
    case "ArrowLeft":
      return { type: "nudge", dx: -step, dy: 0 };
    case "ArrowRight":
      return { type: "nudge", dx: step, dy: 0 };
    default:
      return null;
  }
}

/**
 * jsdom's synthetic pointer events often leave `button` undefined.
 * A missing button is the primary button; only an explicit non-zero
 * button (middle, right) should be ignored.
 */
export function isPrimaryPointerButton(button: number | undefined | null): boolean {
  return button == null || button === 0;
}

function hasResponsiveUtility(el: HTMLElement): boolean {
  for (const name of el.classList) {
    if (/^(sm|md|lg|xl|2xl):/.test(name)) return true;
  }
  return false;
}

/**
 * Whether a canvas root should own keyboard input.
 * Inactive Studio surfaces use the `hidden` class (display:none). Layout
 * engines report that via getComputedStyle; jsdom does not apply Tailwind,
 * so an unstyled `hidden` class counts too. A responsive `hidden sm:flex`
 * is left to computed style, which is what the browser actually paints.
 */
export function isCanvasShown(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hidden) return false;
    if (node.style.display === "none" || node.style.visibility === "hidden") return false;
    let computedDisplay = "";
    let computedVisibility = "";
    try {
      const computed = window.getComputedStyle(node);
      computedDisplay = computed.display;
      computedVisibility = computed.visibility;
    } catch {
      computedDisplay = "";
    }
    if (computedDisplay === "none" || computedVisibility === "hidden") return false;
    if (node.classList.contains("hidden") && !hasResponsiveUtility(node) && computedDisplay !== "none") {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown };
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (node.isContentEditable) return true;
  if (typeof node.closest === "function" && node.closest("[contenteditable='true'], [contenteditable='']")) return true;
  return false;
}

/**
 * Box in the element's positioning coordinates (the values we write as
 * left/top/width/height). `zoom` is the CSS scale applied to an ancestor;
 * getBoundingClientRect includes it, computed left/top do not.
 */
export function measureElementBox(el: HTMLElement, zoom = 1): Box {
  const z = zoom > 0 ? zoom : 1;
  const rect = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  const positioned = cs.position === "absolute" || cs.position === "fixed";
  const parent = el.offsetParent instanceof HTMLElement ? el.offsetParent : el.parentElement;
  const parentRect = parent?.getBoundingClientRect();
  let x = 0;
  let y = 0;
  if (positioned) {
    const left = parseFloat(cs.left);
    const top = parseFloat(cs.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      x = left;
      y = top;
    } else if (parentRect) {
      x = (rect.left - parentRect.left) / z;
      y = (rect.top - parentRect.top) / z;
    }
  } else if (parentRect) {
    x = (rect.left - parentRect.left) / z;
    y = (rect.top - parentRect.top) / z;
  }
  return {
    x,
    y,
    width: Math.max(0, rect.width / z),
    height: Math.max(0, rect.height / z),
  };
}
