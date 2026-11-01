/**
 * Preview dock placement — where the single StudioPreviewPanel instance
 * lives relative to the workspace. The iframe host keeps the same React
 * tree position in every mode; only the host's CSS rect changes, so the
 * preview document, scroll position, element-selection bridge and dev
 * server are never re-mounted on a placement change.
 *
 *   "stage"  — legacy: preview is the active stage surface (escape hatch)
 *   "right"  — pinned to the right edge of the stage, other surfaces left
 *   "left"   — pinned to the left edge of the stage
 *   "float"  — draggable / resizable overlay window
 *   "chat"   — expandable card anchored at the top of the chat transcript
 *   "fullscreen" — occupies the whole workspace (fixed inset-0)
 *   "split"  — code surface on the left, preview pinned to right half
 *
 * localStorage keys follow the existing `littree:studio:*` convention.
 */

export type PreviewPlacement =
  | "stage"
  | "right"
  | "left"
  | "float"
  | "chat"
  | "fullscreen"
  | "split";

export const PREVIEW_DOCK_KEY = "littree:studio:preview-dock";
export const PREVIEW_DOCK_WIDTH_KEY = "littree:studio:preview-dock-width";
export const PREVIEW_FLOAT_RECT_KEY = "littree:studio:preview-float-rect";
export const PREVIEW_SPLIT_FRACTION_KEY = "littree:studio:preview-split-fraction";
export const PREVIEW_CHAT_EXPANDED_KEY = "littree:studio:preview-chat-expanded";

export const PREVIEW_DOCK_DEFAULT_WIDTH = 560;
export const PREVIEW_DOCK_MIN_WIDTH = 320;
export const PREVIEW_DOCK_MAX_WIDTH = 960;

export const PREVIEW_FLOAT_DEFAULT = { x: 96, y: 96, w: 720, h: 520 };
export const PREVIEW_FLOAT_MIN_W = 320;
export const PREVIEW_FLOAT_MIN_H = 240;
export const PREVIEW_FLOAT_MINIMIZED_H = 36;

export const PREVIEW_CHAT_CARD_H = 280;
export const PREVIEW_CHAT_CARD_EXPANDED_H = 520;

export const PREVIEW_SPLIT_DEFAULT_FRACTION = 0.5;
export const PREVIEW_SPLIT_MIN_FRACTION = 0.25;
export const PREVIEW_SPLIT_MAX_FRACTION = 0.75;

export interface PreviewFloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isPreviewPlacement(value: unknown): value is PreviewPlacement {
  return (
    value === "stage" ||
    value === "right" ||
    value === "left" ||
    value === "float" ||
    value === "chat" ||
    value === "fullscreen" ||
    value === "split"
  );
}

export function clampFloatRect(rect: PreviewFloatRect, viewportW: number, viewportH: number): PreviewFloatRect {
  const w = Math.min(Math.max(rect.w, PREVIEW_FLOAT_MIN_W), Math.max(PREVIEW_FLOAT_MIN_W, viewportW - 16));
  const h = Math.min(Math.max(rect.h, PREVIEW_FLOAT_MIN_H), Math.max(PREVIEW_FLOAT_MIN_H, viewportH - 16));
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, viewportW - 64));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, viewportH - 48));
  return { x, y, w, h };
}

export function readStoredPlacement(): PreviewPlacement {
  if (typeof window === "undefined") return "right";
  try {
    const stored = window.localStorage.getItem(PREVIEW_DOCK_KEY);
    return isPreviewPlacement(stored) ? stored : "right";
  } catch {
    return "right";
  }
}

export function readStoredFloatRect(): PreviewFloatRect {
  if (typeof window === "undefined") return { ...PREVIEW_FLOAT_DEFAULT };
  try {
    const raw = window.localStorage.getItem(PREVIEW_FLOAT_RECT_KEY);
    if (!raw) return { ...PREVIEW_FLOAT_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<PreviewFloatRect>;
    if (
      typeof parsed.x === "number" && typeof parsed.y === "number" &&
      typeof parsed.w === "number" && typeof parsed.h === "number"
    ) {
      return clampFloatRect(
        { x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h },
        window.innerWidth || 1280,
        window.innerHeight || 800,
      );
    }
  } catch {
    // fall through
  }
  return { ...PREVIEW_FLOAT_DEFAULT };
}

export const PREVIEW_DOCK_OPTIONS: { value: PreviewPlacement; label: string; hint: string }[] = [
  { value: "right", label: "Dock Right", hint: "Preview pinned to the right of the workspace" },
  { value: "left", label: "Dock Left", hint: "Preview pinned to the left of the workspace" },
  { value: "float", label: "Float", hint: "Draggable, resizable window over Studio" },
  { value: "chat", label: "In Chat", hint: "Expandable preview card at the top of chat" },
  { value: "fullscreen", label: "Fullscreen", hint: "Preview fills the workspace" },
  { value: "split", label: "Code + Preview", hint: "Editor left, live website right" },
  { value: "stage", label: "Stage tab", hint: "Preview only as the active workspace surface" },
];
