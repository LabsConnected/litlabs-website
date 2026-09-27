"use client";

import type { Frame, WorkspaceObject } from "@/lib/studio/workspace-document";

export function WorkspaceMinimap({
  objects,
  onJump,
}: {
  objects: WorkspaceObject[];
  onJump: (canvasX: number, canvasY: number) => void;
}) {
  const width = 160;
  const height = 100;
  const bounds = objects.reduce(
    (box, object) => ({
      minX: Math.min(box.minX, object.frame.x),
      minY: Math.min(box.minY, object.frame.y),
      maxX: Math.max(box.maxX, object.frame.x + object.frame.width),
      maxY: Math.max(box.maxY, object.frame.y + object.frame.height),
    }),
    { minX: 0, minY: 0, maxX: 800, maxY: 600 },
  );
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(width / spanX, height / spanY);
  function place(frame: Frame) {
    return {
      left: (frame.x - bounds.minX) * scale,
      top: (frame.y - bounds.minY) * scale,
      width: Math.max(2, frame.width * scale),
      height: Math.max(2, frame.height * scale),
    };
  }
  return (
    <button
      type="button"
      data-testid="workspace-minimap"
      aria-label="Workspace minimap"
      className="absolute bottom-3 right-3 z-30 overflow-hidden border border-white/15 bg-black/80"
      style={{ width, height, borderRadius: 6 }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const canvasX = bounds.minX + (event.clientX - rect.left) / scale;
        const canvasY = bounds.minY + (event.clientY - rect.top) / scale;
        onJump(canvasX, canvasY);
      }}
    >
      {objects.map((object) => {
        const box = place(object.frame);
        return <span key={object.id} className="absolute bg-white/50" style={box} />;
      })}
    </button>
  );
}
