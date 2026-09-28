import { MAX_ZOOM, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, MIN_ZOOM, SNAP_GRID, type Frame } from "@/lib/studio/workspace-document";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface Point {
  x: number;
  y: number;
}

export interface Guide {
  orientation: "v" | "h";
  pos: number;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], .xterm")) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

export function isPrimaryPointerButton(event: { button: number; pointerType?: string }): boolean {
  return event.button === 0 || event.button == null || event.pointerType === "touch";
}

export function isCanvasShown(node: HTMLElement | null): boolean {
  if (!node) return false;
  let current: HTMLElement | null = node;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return true;
}

export function screenToCanvas(point: Point, viewport: { x: number; y: number; zoom: number }): Point {
  return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom };
}

export function snap(value: number, grid = SNAP_GRID): number {
  return Math.round(value / grid) * grid;
}

export function snapFrame(frame: Frame): Frame {
  return {
    x: snap(frame.x),
    y: snap(frame.y),
    width: Math.max(MIN_WINDOW_WIDTH, snap(frame.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, snap(frame.height)),
  };
}

/** Title bars sit under the canvas toolbar when y is above this line, and a
    negative y puts the handle off the canvas entirely. */
export const TITLE_BAR_MIN_Y = 48;

export function clampReachableFrame(frame: Frame): Frame {
  return {
    ...frame,
    x: Math.max(0, frame.x),
    y: Math.max(TITLE_BAR_MIN_Y, frame.y),
  };
}

export function moveFrame(frame: Frame, dx: number, dy: number): Frame {
  return snapFrame({ ...frame, x: frame.x + dx, y: frame.y + dy });
}

export function resizeFrame(frame: Frame, handle: ResizeHandle, dx: number, dy: number): Frame {
  let { x, y, width, height } = frame;
  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }
  if (width < MIN_WINDOW_WIDTH) {
    if (handle.includes("w")) x -= MIN_WINDOW_WIDTH - width;
    width = MIN_WINDOW_WIDTH;
  }
  if (height < MIN_WINDOW_HEIGHT) {
    if (handle.includes("n")) y -= MIN_WINDOW_HEIGHT - height;
    height = MIN_WINDOW_HEIGHT;
  }
  return snapFrame({ x, y, width, height });
}

export function alignFrame(frame: Frame, others: Frame[], threshold = 6): { frame: Frame; guides: Guide[] } {
  const guides: Guide[] = [];
  let { x, y } = frame;
  const edges = (item: Frame) => [item.x, item.x + item.width, item.x + item.width / 2];
  const ys = (item: Frame) => [item.y, item.y + item.height, item.y + item.height / 2];
  for (const other of others) {
    for (const edge of edges(other)) {
      for (const own of edges(frame)) {
        if (Math.abs(own - edge) <= threshold) {
          x += edge - own;
          guides.push({ orientation: "v", pos: edge });
          break;
        }
      }
    }
    for (const edge of ys(other)) {
      for (const own of ys(frame)) {
        if (Math.abs(own - edge) <= threshold) {
          y += edge - own;
          guides.push({ orientation: "h", pos: edge });
          break;
        }
      }
    }
  }
  return { frame: { ...frame, x, y }, guides };
}

export function zoomAtPoint(
  viewport: { x: number; y: number; zoom: number },
  point: Point,
  deltaY: number,
): { x: number; y: number; zoom: number } {
  const factor = deltaY < 0 ? 1.08 : 1 / 1.08;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
  const canvas = screenToCanvas(point, viewport);
  return {
    zoom,
    x: point.x - canvas.x * zoom,
    y: point.y - canvas.y * zoom,
  };
}

export function hitFrame(frame: Frame, point: Point): boolean {
  return point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height;
}

export function marqueeHits(frame: Frame, rect: Frame): boolean {
  return frame.x < rect.x + rect.width && frame.x + frame.width > rect.x && frame.y < rect.y + rect.height && frame.y + frame.height > rect.y;
}
