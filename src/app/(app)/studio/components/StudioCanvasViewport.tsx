"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

type Props = { children: ReactNode; enabled: boolean; storageKey: string };

export default function StudioCanvasViewport({ children, enabled, storageKey }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(`litt:studio:canvas:${storageKey}`) ?? "null") as { zoom?: number; pan?: { x: number; y: number } } | null;
      if (saved?.zoom) setZoom(Math.min(1.6, Math.max(0.6, saved.zoom)));
      if (saved?.pan) setPan(saved.pan);
    } catch { /* optional preference */ }
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!enabled) return;
    try { window.localStorage.setItem(`litt:studio:canvas:${storageKey}`, JSON.stringify({ zoom, pan })); } catch { /* optional preference */ }
  }, [enabled, pan, storageKey, zoom]);

  const changeZoom = (delta: number) => setZoom((value) => Math.min(1.6, Math.max(0.6, Math.round((value + delta) * 20) / 20)));
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!enabled) return;
    event.preventDefault();
    changeZoom(event.deltaY > 0 ? -0.05 : 0.05);
  };
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 1) return;
    event.preventDefault();
    panRef.current = { startX: event.clientX, startY: event.clientY, ...pan };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag) return;
    setPan({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY });
  };
  const stopPan = () => { panRef.current = null; };

  return (
    <div className={`studio-canvas-viewport ${enabled ? "studio-canvas-viewport--enabled" : ""}`} onWheel={handleWheel} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan}>
      {enabled && (
        <div className="studio-canvas-controls" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-label="Zoom out" onClick={() => changeZoom(-0.1)}><Minus size={13} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => changeZoom(0.1)}><Plus size={13} /></button>
          <button type="button" aria-label="Reset canvas view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><RotateCcw size={13} /></button>
        </div>
      )}
      <div className="studio-canvas-surface" style={enabled ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } : undefined}>
        {children}
      </div>
    </div>
  );
}
