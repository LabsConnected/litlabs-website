"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  inverseWorkspaceAction,
  type Frame,
  type HttpWorkspaceAction,
  type WorkspaceAction,
  type WorkspaceObject,
} from "@/lib/studio/workspace-document";
import { ChatWindowBody } from "./bodies/ChatWindowBody";
import { DeferredObjectBody } from "./bodies/DeferredObjectBody";
import { NoteWindowBody } from "./bodies/NoteWindowBody";
import { TaskWindowBody } from "./bodies/TaskWindowBody";
import { WorkspaceChecklist } from "./WorkspaceChecklist";
import { WorkspaceMinimap } from "./WorkspaceMinimap";
import { WorkspaceWindow } from "./WorkspaceWindow";
import {
  alignFrame,
  isCanvasShown,
  isPrimaryPointerButton,
  isTypingTarget,
  marqueeHits,
  moveFrame,
  resizeFrame,
  screenToCanvas,
  zoomAtPoint,
  type Point,
  type ResizeHandle,
} from "./workspace-geometry";
import { useWorkspaceStore } from "./workspace-store";

export function SpatialWorkspace({ projectId }: { projectId: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const workspaceDoc = useWorkspaceStore((state) => state.document);
  const selectedIds = useWorkspaceStore((state) => state.selectedIds);
  const load = useWorkspaceStore((state) => state.load);
  const select = useWorkspaceStore((state) => state.select);
  const commit = useWorkspaceStore((state) => state.commit);
  const undoAction = useWorkspaceStore((state) => state.undoAction);
  const redoAction = useWorkspaceStore((state) => state.redoAction);
  const shiftAction = useWorkspaceStore((state) => state.shiftAction);
  const pendingActions = useWorkspaceStore((state) => state.pendingActions);
  const [viewport, setViewport] = useState(workspaceDoc.viewport);
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [guides, setGuides] = useState<{ orientation: "v" | "h"; pos: number }[]>([]);
  const [marquee, setMarquee] = useState<Frame | null>(null);
  const [space, setSpace] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const wheelTimer = useRef<number | null>(null);
  const viewportRef = useRef(viewport);
  const framesRef = useRef(frames);
  viewportRef.current = viewport;
  framesRef.current = frames;

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  useEffect(() => {
    setViewport(workspaceDoc.viewport);
    setFrames({});
    setNotes(Object.fromEntries(workspaceDoc.objects.filter((object) => object.type === "note").map((object) => [object.id, String(object.payload.body ?? "")])));
  }, [workspaceDoc]);

  const frameOf = useCallback((object: WorkspaceObject) => frames[object.id] ?? object.frame, [frames]);

  const run = useCallback(async (action: HttpWorkspaceAction) => {
    const current = useWorkspaceStore.getState().document;
    const mapped = httpToWorkspaceAction(action);
    const inverse = mapped ? inverseWorkspaceAction(current, mapped) : null;
    const beforeIds = new Set(current.objects.map((object) => object.id));
    const beforeRels = new Set(current.relationships.map((item) => item.id));
    const ok = await commit(action, inverse);
    if (!ok) return false;
    const latest = useWorkspaceStore.getState().document;
    const created = latest.objects.find((object) => !beforeIds.has(object.id));
    if (created && (action.type === "workspace.create" || action.type === "workspace.duplicate")) {
      select([created.id]);
      useWorkspaceStore.setState((state) => ({ undo: [...state.undo, { type: "workspace.delete", id: created.id }] }));
    }
    const linked = latest.relationships.find((item) => !beforeRels.has(item.id));
    if (linked && action.type === "workspace.link") {
      useWorkspaceStore.setState((state) => ({ undo: [...state.undo, { type: "workspace.unlink", id: linked.id }] }));
    }
    return true;
  }, [commit, select]);

  useEffect(() => {
    if (status !== "ready" || pendingActions.length === 0) return;
    const action = shiftAction();
    if (action) void run(action);
  }, [status, pendingActions, shiftAction, run]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isCanvasShown(rootRef.current) || isTypingTarget(event.target)) return;
      if (event.code === "Space") setSpace(true);
      const ids = useWorkspaceStore.getState().selectedIds;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void redoAction();
        else void undoAction();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (ids[0]) void run({ type: "workspace.duplicate", id: ids[0] });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        for (const id of ids) void run({ type: "workspace.delete", id });
      } else if (event.key === "Escape") {
        select([]);
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && ids.length) {
        event.preventDefault();
        const step = event.shiftKey ? 8 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        for (const id of ids) {
          const object = workspaceDoc.objects.find((item) => item.id === id);
          if (!object) continue;
          void run({ type: "workspace.update", id, frame: moveFrame(object.frame, dx, dy) });
        }
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpace(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [workspaceDoc.objects, redoAction, run, select, undoAction]);

  function beginGesture(event: React.PointerEvent, onMove: (point: Point) => void, onEnd: () => void) {
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture?.(event.pointerId); } catch { /* jsdom */ }
    const move = (pointer: PointerEvent) => {
      if (!Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY)) return;
      onMove({ x: pointer.clientX, y: pointer.clientY });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      onEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function onBackgroundPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!isPrimaryPointerButton(event) && event.button !== 1) return;
    const origin = { x: event.clientX, y: event.clientY };
    const start = { ...viewport };
    const marqueeStart = screenToCanvas(origin, viewport);
    if (space || event.button === 1 || !event.shiftKey) {
      beginGesture(event, (point) => {
        const next = { ...start, x: start.x + point.x - origin.x, y: start.y + point.y - origin.y };
        viewportRef.current = next;
        setViewport(next);
      }, () => {
        const next = viewportRef.current;
        void run({ type: "workspace.viewport", viewport: { x: next.x, y: next.y, zoom: next.zoom } });
      });
      if (!event.shiftKey) select([]);
      return;
    }
    beginGesture(event, (point) => {
      const current = screenToCanvas(point, viewport);
      setMarquee({
        x: Math.min(marqueeStart.x, current.x),
        y: Math.min(marqueeStart.y, current.y),
        width: Math.abs(current.x - marqueeStart.x),
        height: Math.abs(current.y - marqueeStart.y),
      });
    }, () => {
      setMarquee((rect) => {
        if (rect) {
          const hits = workspaceDoc.objects.filter((object) => marqueeHits(object.frame, rect)).map((object) => object.id);
          select(hits);
        }
        return null;
      });
    });
  }

  function onTitlePointerDown(object: WorkspaceObject, event: React.PointerEvent) {
    event.stopPropagation();
    if (!isPrimaryPointerButton(event)) return;
    const origin = screenToCanvas(eventPoint(event), viewport);
    const selected = selectedIds.includes(object.id) ? selectedIds : [object.id];
    if (!selectedIds.includes(object.id)) select(selected);
    const starts = Object.fromEntries(workspaceDoc.objects.filter((item) => selected.includes(item.id)).map((item) => [item.id, { ...item.frame }]));
    beginGesture(event, (point) => {
      const current = screenToCanvas(point, viewport);
      const dx = current.x - origin.x;
      const dy = current.y - origin.y;
      const next: Record<string, Frame> = {};
      let shown: { orientation: "v" | "h"; pos: number }[] = [];
      for (const id of Object.keys(starts)) {
        const moved = moveFrame(starts[id], dx, dy);
        const others = workspaceDoc.objects.filter((item) => item.id !== id).map((item) => frames[item.id] ?? item.frame);
        const aligned = alignFrame(moved, others);
        next[id] = aligned.frame;
        shown = aligned.guides;
      }
      framesRef.current = { ...framesRef.current, ...next };
      setFrames(framesRef.current);
      setGuides(shown);
    }, () => {
      setGuides([]);
      for (const id of Object.keys(starts)) {
        const frame = framesRef.current[id];
        if (frame) void run({ type: "workspace.update", id, frame });
      }
    });
  }

  function onResizePointerDown(object: WorkspaceObject, handle: ResizeHandle, event: React.PointerEvent) {
    if (!isPrimaryPointerButton(event)) return;
    event.stopPropagation();
    const origin = screenToCanvas(eventPoint(event), viewport);
    const start = { ...object.frame };
    beginGesture(event, (point) => {
      const current = screenToCanvas(point, viewport);
      const frame = resizeFrame(start, handle, current.x - origin.x, current.y - origin.y);
      framesRef.current = { ...framesRef.current, [object.id]: frame };
      setFrames(framesRef.current);
    }, () => {
      const frame = framesRef.current[object.id];
      if (frame) void run({ type: "workspace.update", id: object.id, frame });
    });
  }

  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = zoomAtPoint(viewportRef.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.deltaY);
    viewportRef.current = next;
    setViewport(next);
    if (wheelTimer.current != null) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      void run({ type: "workspace.viewport", viewport: viewportRef.current });
    }, 200) as unknown as number;
  }

  const chat = workspaceDoc.objects.find((object) => selectedIds.includes(object.id) && object.type === "chat");
  const task = workspaceDoc.objects.find((object) => selectedIds.includes(object.id) && object.type === "task");

  if (!projectId) {
    return (
      <div ref={rootRef} data-testid="spatial-workspace" className="flex h-full items-center justify-center bg-[#07080b] text-sm text-white/60">
        Open a project to use the workspace.
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-testid="spatial-workspace"
      className="relative h-full overflow-hidden bg-[#07080b] text-white"
      onWheel={onWheel}
    >
      <div className="absolute left-3 top-3 z-30 flex gap-2 text-[11px]">
        <button type="button" data-testid="workspace-new-chat" onClick={() => void run({ type: "workspace.create", objectType: "chat" })}>New chat</button>
        <button type="button" data-testid="workspace-new-task" onClick={() => void run({ type: "workspace.create", objectType: "task" })}>New task</button>
        <button type="button" data-testid="workspace-new-note" onClick={() => void run({ type: "workspace.create", objectType: "note" })}>New note</button>
        <button type="button" onClick={() => void undoAction()}>Undo</button>
        <button type="button" onClick={() => void redoAction()}>Redo</button>
        <button
          type="button"
          data-testid="workspace-link-selection"
          disabled={!chat || !task}
          onClick={() => {
            if (chat && task) void run({ type: "workspace.link", fromId: chat.id, toId: task.id });
          }}
        >
          Link chat and task
        </button>
      </div>
      <WorkspaceChecklist />
      {status === "loading" ? <p className="absolute left-3 top-40 z-30 text-xs text-white/50">Loading workspace…</p> : null}
      {error ? <p className="absolute left-3 top-48 z-30 max-w-sm text-xs text-red-300">{error}</p> : null}
      <div
        data-testid="workspace-canvas"
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)",
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
        onPointerDown={onBackgroundPointerDown}
      >
        <div style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, transformOrigin: "0 0" }}>
          {workspaceDoc.relationships.map((relationship) => {
            const from = workspaceDoc.objects.find((object) => object.id === relationship.fromId);
            const to = workspaceDoc.objects.find((object) => object.id === relationship.toId);
            if (!from || !to) return null;
            const a = frameOf(from);
            const b = frameOf(to);
            return <svg key={relationship.id} className="pointer-events-none absolute overflow-visible" width="1" height="1"><line x1={a.x + a.width / 2} y1={a.y + a.height / 2} x2={b.x + b.width / 2} y2={b.y + b.height / 2} stroke="rgba(114,242,56,0.45)" strokeWidth={2} /></svg>;
          })}
          {guides.map((guide, index) => (
            <div key={`${guide.orientation}-${guide.pos}-${index}`} className="pointer-events-none absolute bg-[#72f238]" style={guide.orientation === "v" ? { left: guide.pos, top: -2000, width: 1, height: 4000 } : { top: guide.pos, left: -2000, height: 1, width: 4000 }} />
          ))}
          {workspaceDoc.objects.slice().sort((a, b) => a.z - b.z).map((object) => (
            <WorkspaceWindow
              key={object.id}
              object={object}
              frame={frameOf(object)}
              selected={selectedIds.includes(object.id)}
              onFocus={() => select(selectedIds.includes(object.id) ? selectedIds : [object.id])}
              onTitlePointerDown={(event) => onTitlePointerDown(object, event)}
              onResizePointerDown={(handle, event) => onResizePointerDown(object, handle, event)}
              onMinimize={() => void run({ type: "workspace.update", id: object.id, collapsed: !object.collapsed })}
            >
              {renderBody(object, notes, setNotes, run)}
            </WorkspaceWindow>
          ))}
          {marquee ? <div className="absolute border border-[#72f238]/70 bg-[#72f238]/10" style={marquee} /> : null}
        </div>
      </div>
      {status === "ready" && workspaceDoc.objects.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/45">
          This workspace is empty. Create a chat, a task, or a note.
        </div>
      ) : null}
      <WorkspaceMinimap
        objects={workspaceDoc.objects}
        onJump={(canvasX, canvasY) => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) return;
          const next = { ...viewport, x: rect.width / 2 - canvasX * viewport.zoom, y: rect.height / 2 - canvasY * viewport.zoom };
          setViewport(next);
          void run({ type: "workspace.viewport", viewport: next });
        }}
      />
    </div>
  );
}

function httpToWorkspaceAction(action: HttpWorkspaceAction): WorkspaceAction | null {
  switch (action.type) {
    case "workspace.update":
      return {
        type: "workspace.update",
        id: action.id,
        patch: {
          title: action.title,
          frame: action.frame,
          z: action.z,
          collapsed: action.collapsed,
          accent: action.accent,
          tags: action.tags,
          payload: action.noteBody !== undefined ? { body: action.noteBody } : undefined,
        },
      };
    case "workspace.delete":
      return { type: "workspace.delete", id: action.id };
    case "workspace.focus":
      return { type: "workspace.focus", id: action.id };
    case "workspace.viewport":
      return { type: "workspace.viewport", viewport: action.viewport };
    case "workspace.unlink":
      return { type: "workspace.unlink", id: action.id };
    case "workspace.restore":
      return { type: "workspace.restore", object: action.object, relationships: action.relationships ?? [] };
    default:
      return null;
  }
}

function eventPoint(event: { clientX: number; clientY: number; nativeEvent?: Event }): Point {
  const native = event.nativeEvent as PointerEvent | undefined;
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : native?.clientX ?? 0,
    y: Number.isFinite(event.clientY) ? event.clientY : native?.clientY ?? 0,
  };
}

function renderBody(
  object: WorkspaceObject,
  notes: Record<string, string>,
  setNotes: (value: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void,
  run: (action: HttpWorkspaceAction) => Promise<boolean>,
) {
  if (object.type === "chat" && typeof object.payload.conversationId === "string") return <ChatWindowBody conversationId={object.payload.conversationId} />;
  if (object.type === "task" && typeof object.payload.taskId === "string") return <TaskWindowBody taskId={object.payload.taskId} />;
  if (object.type === "note") {
    return (
      <NoteWindowBody
        body={notes[object.id] ?? ""}
        onChange={(value) => setNotes((prev) => ({ ...prev, [object.id]: value }))}
        onBlur={() => void run({ type: "workspace.update", id: object.id, noteBody: notes[object.id] ?? "" })}
      />
    );
  }
  return <DeferredObjectBody object={object} />;
}
