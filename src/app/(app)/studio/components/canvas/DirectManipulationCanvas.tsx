"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SelectionChrome, type SelectionGesture } from "./SelectionChrome";
import {
  applyGesture,
  canvasKeyAction,
  geometryToStylePatch,
  isCanvasShown,
  isPrimaryPointerButton,
  panBy,
  zoomByWheel,
  type Box,
  type ElementStylePatch,
} from "./direct-manipulation";

export interface DirectElement {
  id: string;
  label: string;
  tagName: string;
  selector: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background?: string;
  color?: string;
}

export const DEMO_CANVAS_ELEMENTS: DirectElement[] = [
  {
    id: "hero",
    label: "Hero heading",
    tagName: "h1",
    selector: "#hero",
    text: "Build with LiTT",
    x: 48,
    y: 36,
    width: 320,
    height: 72,
    background: "#1c1233",
    color: "#f4eeff",
  },
  {
    id: "copy",
    label: "Body copy",
    tagName: "p",
    selector: "#copy",
    text: "Drag to move. Drag a handle to resize.",
    x: 48,
    y: 128,
    width: 280,
    height: 64,
    background: "#121826",
    color: "#d6def5",
  },
  {
    id: "cta",
    label: "Button",
    tagName: "button",
    selector: "#cta",
    text: "Get started",
    x: 48,
    y: 212,
    width: 148,
    height: 44,
    background: "#9b4dff",
    color: "#ffffff",
  },
];

export interface DirectCommit {
  element: DirectElement;
  patch: ElementStylePatch;
}

/**
 * Same-origin artboard used by the design canvas and the visual harness.
 * Geometry commits are reported as element-inspector style patches.
 */
export function DirectManipulationCanvas({
  elements: initialElements = DEMO_CANVAS_ELEMENTS,
  onCommit,
  onSelect,
}: {
  elements?: DirectElement[];
  onCommit?: (commit: DirectCommit) => void;
  onSelect?: (element: DirectElement | null) => void;
}) {
  const [elements, setElements] = useState<DirectElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const spaceDown = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number; pointerId: number } | null>(null);
  const gestureStart = useRef<Box | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = elements.find((el) => el.id === selectedId) ?? null;

  const select = useCallback((element: DirectElement | null) => {
    setSelectedId(element?.id ?? null);
    onSelect?.(element);
  }, [onSelect]);

  const commitBox = useCallback((element: DirectElement, box: Box) => {
    const next: DirectElement = {
      ...element,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
    setElements((current) => current.map((item) => (item.id === element.id ? next : item)));
    onCommit?.({ element: next, patch: geometryToStylePatch(box) });
  }, [onCommit]);

  const onGesture = useCallback((gesture: SelectionGesture) => {
    if (!selected) return;
    if (gesture.phase === "start") {
      gestureStart.current = { x: selected.x, y: selected.y, width: selected.width, height: selected.height };
      return;
    }
    const start = gestureStart.current;
    if (!start) return;
    const next = applyGesture(start, gesture.kind, gesture.dx, gesture.dy, gesture.shiftKey);
    if (gesture.phase === "move") {
      setElements((current) => current.map((item) => (
        item.id === selected.id ? { ...item, ...next } : item
      )));
      return;
    }
    gestureStart.current = null;
    commitBox(selected, next);
  }, [commitBox, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!rootRef.current || !isCanvasShown(rootRef.current)) return;
      const action = canvasKeyAction(event, event.target);
      if (!action) return;
      if (action.type === "space") {
        if (event.repeat) return;
        event.preventDefault();
        spaceDown.current = true;
        setSpaceHeld(true);
        return;
      }
      if (action.type === "deselect") {
        event.preventDefault();
        select(null);
        return;
      }
      if (!selected) return;
      event.preventDefault();
      commitBox(selected, {
        x: selected.x + action.dx,
        y: selected.y + action.dy,
        width: selected.width,
        height: selected.height,
      });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
        spaceDown.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [commitBox, select, selected]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setZoom((current) => zoomByWheel(current, event.deltaY));
        return;
      }
      event.preventDefault();
      setPan((current) => panBy(current, -event.deltaX, -event.deltaY));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const onViewportPointerDown = (event: React.PointerEvent) => {
    const panning = event.button === 1 || spaceDown.current;
    if (!panning) return;
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    try { el.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
    panDrag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, pointerId: event.pointerId };
  };

  const onViewportPointerMove = (event: React.PointerEvent) => {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.panX + (event.clientX - drag.x),
      y: drag.panY + (event.clientY - drag.y),
    });
  };

  const onViewportPointerUp = (event: React.PointerEvent) => {
    if (panDrag.current?.pointerId === event.pointerId) panDrag.current = null;
  };

  return (
    <div
      ref={rootRef}
      data-testid="direct-manipulation-canvas"
      data-direct-canvas=""
      data-active="true"
      className="relative h-full min-h-0 w-full overflow-hidden"
      style={{
        background: "#0a0b10",
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)",
        backgroundSize: "20px 20px",
        cursor: spaceHeld ? "grab" : "default",
        touchAction: "none",
      }}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={onViewportPointerUp}
      onPointerCancel={onViewportPointerUp}
    >
      <div
        data-testid="canvas-viewport"
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) select(null);
        }}
      >
        {elements.map((element) => {
          const isSelected = element.id === selectedId;
          return (
            <div key={element.id} style={{ position: "absolute", left: element.x, top: element.y, width: element.width, height: element.height }}>
              <button
                type="button"
                data-testid={`canvas-element-${element.id}`}
                data-element-id={element.id}
                onPointerDown={(event) => {
                  if (spaceDown.current || !isPrimaryPointerButton(event.button)) return;
                  event.stopPropagation();
                  if (!isSelected) select(element);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  select(element);
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: element.tagName === "button" ? "center" : "flex-start",
                  padding: "0 14px",
                  border: "none",
                  borderRadius: element.tagName === "button" ? 999 : 10,
                  background: element.background ?? "#16161f",
                  color: element.color ?? "#fff",
                  font: "inherit",
                  fontSize: element.tagName === "h1" ? 22 : 13,
                  fontWeight: element.tagName === "h1" ? 800 : 600,
                  textAlign: "left",
                  cursor: isSelected ? "move" : "pointer",
                  pointerEvents: isSelected ? "none" : "auto",
                }}
              >
                {element.text ?? element.label}
              </button>
              {isSelected && (
                <SelectionChrome
                  box={{ x: 0, y: 0, width: element.width, height: element.height }}
                  zoom={zoom}
                  label={`${element.tagName} · ${Math.round(element.width)}×${Math.round(element.height)}`}
                  onGesture={onGesture}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
