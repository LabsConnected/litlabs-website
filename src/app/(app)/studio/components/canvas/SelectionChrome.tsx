"use client";

import { useRef } from "react";
import { RESIZE_HANDLES, isPrimaryPointerButton, type GestureKind, type ResizeHandle } from "./direct-manipulation";

const HANDLE_SIZE = 8;

const CURSOR: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

function handleStyle(handle: ResizeHandle): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    marginLeft: handle.includes("e") || handle.includes("w") ? 0 : -HANDLE_SIZE / 2,
    marginTop: handle === "e" || handle === "w" ? -HANDLE_SIZE / 2 : 0,
    background: "#fff",
    border: "1.5px solid #9b4dff",
    borderRadius: 2,
    cursor: CURSOR[handle],
    pointerEvents: "auto",
    zIndex: 2,
    boxSizing: "border-box",
  };
  if (handle.includes("n")) base.top = -HANDLE_SIZE / 2;
  if (handle.includes("s")) base.bottom = -HANDLE_SIZE / 2;
  if (handle.includes("w")) base.left = -HANDLE_SIZE / 2;
  if (handle.includes("e")) base.right = -HANDLE_SIZE / 2;
  if (handle === "n" || handle === "s") {
    base.left = "50%";
    base.marginLeft = -HANDLE_SIZE / 2;
  }
  if (handle === "e" || handle === "w") {
    base.top = "50%";
  }
  return base;
}

export interface SelectionGesture {
  phase: "start" | "move" | "end";
  kind: GestureKind;
  /** Total delta from gesture start, in canvas pixels (zoom already removed). */
  dx: number;
  dy: number;
  shiftKey: boolean;
}

/**
 * Selection outline plus the eight resize handles. The parent owns the box;
 * this component only reports pointer deltas.
 */
export function SelectionChrome({
  box,
  zoom = 1,
  label,
  onGesture,
}: {
  box: { x: number; y: number; width: number; height: number };
  zoom?: number;
  label?: string;
  onGesture: (gesture: SelectionGesture) => void;
}) {
  const drag = useRef<{ kind: GestureKind; x: number; y: number; pointerId: number } | null>(null);

  const begin = (kind: GestureKind, event: React.PointerEvent) => {
    if (!isPrimaryPointerButton(event.button)) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 0;
    try { el.setPointerCapture(pointerId); } catch { /* jsdom */ }
    drag.current = { kind, x: event.clientX, y: event.clientY, pointerId };
    onGesture({ phase: "start", kind, dx: 0, dy: 0, shiftKey: event.shiftKey });
  };

  const move = (event: React.PointerEvent) => {
    const current = drag.current;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 0;
    if (!current || current.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const z = zoom > 0 ? zoom : 1;
    onGesture({
      phase: "move",
      kind: current.kind,
      dx: (event.clientX - current.x) / z,
      dy: (event.clientY - current.y) / z,
      shiftKey: event.shiftKey,
    });
  };

  const end = (event: React.PointerEvent) => {
    const current = drag.current;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 0;
    if (!current || current.pointerId !== pointerId) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    const z = zoom > 0 ? zoom : 1;
    onGesture({
      phase: "end",
      kind: current.kind,
      dx: (event.clientX - current.x) / z,
      dy: (event.clientY - current.y) / z,
      shiftKey: event.shiftKey,
    });
    drag.current = null;
  };

  return (
    <div
      data-testid="selection-chrome"
      data-direct-canvas-chrome=""
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        outline: "2px solid #9b4dff",
        outlineOffset: 0,
        boxShadow: "0 0 0 4px rgba(155,77,255,0.16)",
        pointerEvents: "auto",
        cursor: "move",
        zIndex: 5,
        boxSizing: "border-box",
      }}
      onPointerDown={(event) => begin("move", event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {label && (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 0,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "#fff",
            background: "#9b4dff",
            borderRadius: 3,
            padding: "1px 6px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          data-testid={`resize-handle-${handle}`}
          data-handle={handle}
          style={handleStyle(handle)}
          onPointerDown={(event) => begin(handle, event)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </div>
  );
}
