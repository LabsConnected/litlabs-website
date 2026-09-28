"use client";

import type { CSSProperties, PointerEvent, ReactNode } from "react";
import type { Frame, WorkspaceObject } from "@/lib/studio/workspace-document";
import type { ResizeHandle } from "./workspace-geometry";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function WorkspaceWindow({
  object,
  frame,
  selected,
  onFocus,
  onTitlePointerDown,
  onResizePointerDown,
  onMinimize,
  children,
}: {
  object: WorkspaceObject;
  frame: Frame;
  selected: boolean;
  onFocus: (event: PointerEvent<HTMLElement>) => void;
  onTitlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (handle: ResizeHandle, event: PointerEvent<HTMLButtonElement>) => void;
  onMinimize: () => void;
  children: ReactNode;
}) {
  return (
    <article
      data-testid={`workspace-window-${object.id}`}
      data-object-type={object.type}
      data-selected={selected ? "true" : "false"}
      className="absolute flex flex-col overflow-hidden border bg-[#0c0d10] text-white shadow-lg"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: object.collapsed ? 32 : frame.height,
        zIndex: object.z,
        borderRadius: 6,
        borderColor: selected ? "rgba(114,242,56,0.85)" : "rgba(255,255,255,0.12)",
      }}
      onPointerDown={onFocus}
    >
      <div
        data-testid={`workspace-title-${object.id}`}
        className="flex h-8 cursor-grab items-center gap-2 border-b border-white/10 px-2 text-[12px]"
        onPointerDown={onTitlePointerDown}
      >
        <span className="text-[10px] uppercase tracking-wide text-white/40">{object.type}</span>
        <span className="min-w-0 flex-1 truncate">{object.title}</span>
        <button type="button" aria-label={object.collapsed ? "Expand window" : "Minimize window"} className="text-white/50" onPointerDown={(event) => event.stopPropagation()} onClick={onMinimize}>
          {object.collapsed ? "+" : "–"}
        </button>
      </div>
      {object.collapsed ? null : <div className="min-h-0 flex-1">{children}</div>}
      {HANDLES.map((handle) => (
        <button
          key={handle}
          type="button"
          aria-label={`Resize ${handle}`}
          data-resize-handle={handle}
          className="absolute z-10 bg-transparent"
          style={handleStyle(handle)}
          onPointerDown={(event) => onResizePointerDown(handle, event)}
        />
      ))}
    </article>
  );
}

function handleStyle(handle: ResizeHandle): CSSProperties {
  const edge = 8;
  const corner = 12;
  const map: Record<ResizeHandle, React.CSSProperties> = {
    n: { top: 0, left: corner, right: corner, height: edge, cursor: "ns-resize" },
    s: { bottom: 0, left: corner, right: corner, height: edge, cursor: "ns-resize" },
    e: { right: 0, top: corner, bottom: corner, width: edge, cursor: "ew-resize" },
    w: { left: 0, top: corner, bottom: corner, width: edge, cursor: "ew-resize" },
    nw: { top: 0, left: 0, width: corner, height: corner, cursor: "nwse-resize" },
    ne: { top: 0, right: 0, width: corner, height: corner, cursor: "nesw-resize" },
    se: { bottom: 0, right: 0, width: corner, height: corner, cursor: "nwse-resize" },
    sw: { bottom: 0, left: 0, width: corner, height: corner, cursor: "nesw-resize" },
  };
  return map[handle];
}
