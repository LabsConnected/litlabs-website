"use client";

import { useCallback, useEffect, useMemo, useRef, type PointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { studioWindowManager, useStudioWindowManager, type StudioWindowBounds, type StudioWindowType } from "./StudioWindowManager";

type StudioWindowFrameProps = {
  id: string;
  taskId?: string;
  projectId?: string;
  type?: StudioWindowType;
  title: string;
  children: ReactNode;
  defaultRect: StudioWindowBounds;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  onClose?: () => void;
};

const DEFAULT_TASK = "task:current";

export default function StudioWindowFrame({
  id, taskId = DEFAULT_TASK, projectId = "project:current", type = "chat", title, children,
  defaultRect, minWidth = 280, minHeight = 240, className = "", onClose,
}: StudioWindowFrameProps) {
  const scope = useMemo(() => ({ projectId, taskId }), [projectId, taskId]);
  const { windows } = useStudioWindowManager(scope);
  const windowId = `litt:studio:layout:${projectId}:${taskId}:${id}`;
  const current = windows.find((item) => item.id === windowId);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; rect: StudioWindowBounds } | null>(null);

  useEffect(() => {
    studioWindowManager.openWindow({ id: windowId, taskId, type, bounds: current?.bounds ?? defaultRect }, scope);
    // The manager owns subsequent geometry changes; this only registers a new window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId, taskId, type]);

  const focus = useCallback(() => studioWindowManager.focusWindow(windowId, scope), [scope, windowId]);
  const stopPointer = useCallback(() => {
    dragRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);
  useEffect(() => () => stopPointer(), [stopPointer]);

  const startPointer = (event: PointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    if (event.button !== 0) return;
    focus();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect: current?.bounds ?? defaultRect };
    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag) return;
    const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY;
    const bounds = drag.mode === "move"
      ? { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }
      : { ...drag.rect, width: Math.max(minWidth, drag.rect.width + dx), height: Math.max(minHeight, drag.rect.height + dy) };
    studioWindowManager.updateWindow(windowId, { bounds }, scope);
  };

  if (!current || current.minimized) return null;
  const bounds = current.maximized ? { x: 8, y: 8, width: 0, height: 0 } : current.bounds;
  return (
    <section className={`studio-freeform-window studio-freeform-window--focused ${className}`} data-studio-window={id}
      style={{ left: bounds.x, top: bounds.y, ...(current.maximized ? { right: 8, bottom: 8, width: "auto", height: "auto" } : { width: bounds.width, height: bounds.height }), zIndex: current.zIndex }} onPointerDown={focus}>
      <div className="studio-freeform-window__grab" data-studio-window-grab role="button" tabIndex={0}
        onPointerDown={(event) => startPointer(event, "move")} onPointerMove={handlePointerMove} onPointerUp={stopPointer} onPointerCancel={stopPointer}>
        <span className="studio-freeform-window__title">{title}</span>
        <span className="studio-freeform-window__hint">{taskId === DEFAULT_TASK ? "Current task" : taskId.slice(0, 12)}</span>
        <button type="button" aria-label={`${current.maximized ? "Restore" : "Maximize"} ${title}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => studioWindowManager.updateWindow(windowId, { maximized: !current.maximized }, scope)}>{current.maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</button>
        {onClose && <button type="button" aria-label={`Close ${title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={12} /></button>}
      </div>
      <div className="studio-freeform-window__body">{children}</div>
      <div className="studio-freeform-window__resize" data-studio-window-resize role="button" tabIndex={0} aria-label={`Resize ${title} window`}
        onPointerDown={(event) => startPointer(event, "resize")} onPointerMove={handlePointerMove} onPointerUp={stopPointer} onPointerCancel={stopPointer} />
    </section>
  );
}
