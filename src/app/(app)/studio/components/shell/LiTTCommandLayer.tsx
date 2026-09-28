"use client";

/**
 * LiTTCommandLayer — the shell's permanent AI command layer.
 *
 * Collapsed: a compact composer bar spanning the bottom of the shell.
 * Expanded: transcript/approvals/tool calls expand UPWARD and vertically
 * resize the central workspace — it never floats over or covers the stage.
 * Esc collapses. Expanded state + height persist per project.
 *
 * This is shell chrome, not a surface: it receives context from whatever
 * is active/selected (task, element, file, surface) via `contextLine` on
 * the composer rendered by the caller.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import ChatDockSwitcher, { type ChatDockPosition } from "../ChatDockSwitcher";

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 300;
const BAR_KEY = (storageKey: string) => `litt:studio:littbar:${storageKey}`;

export default function LiTTCommandLayer({
  storageKey,
  busy,
  expanded,
  onExpandedChange,
  transcript,
  composer,
  statusBar,
  dockPosition,
  onDockPositionChange,
}: {
  /** Scope for persisted expand/height state (project id or "default"). */
  storageKey: string;
  busy: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Transcript region — approvals, run state, history (mounted when expanded). */
  transcript: ReactNode;
  /** Always-visible composer bar (input, chips, controls). */
  composer: ReactNode;
  /** Always-visible run-state strip (StudioOperatorBar) between the
      transcript and the composer. */
  statusBar?: ReactNode;
  /** Chat dock position — when provided (with onDockPositionChange), the
      header renders the Left/Bottom dock switcher. */
  dockPosition?: ChatDockPosition;
  onDockPositionChange?: (position: ChatDockPosition) => void;
}) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragRef = useRef<{ startY: number; startH: number; pointerId: number } | null>(null);

  // Restore persisted expanded state + height.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(BAR_KEY(storageKey)) ?? "null") as
        { expanded?: boolean; height?: number } | null;
      if (saved) {
        if (typeof saved.height === "number") {
          setHeight(Math.min(Math.round(window.innerHeight * 0.7), Math.max(MIN_HEIGHT, saved.height)));
        }
        if (typeof saved.expanded === "boolean") onExpandedChange(saved.expanded);
      }
    } catch { /* optional preference */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (nextExpanded: boolean, nextHeight: number) => {
      try {
        window.localStorage.setItem(BAR_KEY(storageKey), JSON.stringify({ expanded: nextExpanded, height: nextHeight }));
      } catch { /* optional */ }
    },
    [storageKey],
  );

  const applyHeight = useCallback((h: number) => {
    setHeight(h);
    persist(expanded, h);
  }, [expanded, persist]);

  // Esc collapses — skip while typing in an input/textarea.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      onExpandedChange(false);
      persist(false, height);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, height, onExpandedChange, persist]);

  const onEdgeDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { startY: e.clientY, startH: height, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onEdgeMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // The layer is bottom-anchored: dragging up increases height.
    const next = d.startH + (d.startY - e.clientY);
    applyHeight(Math.min(Math.round(window.innerHeight * 0.7), Math.max(MIN_HEIGHT, next)));
  };
  const onEdgeUp = () => { dragRef.current = null; };

  return (
    <section
      aria-label="LiTT command layer"
      data-testid="litt-command-layer"
      className="glass-shell flex w-full shrink-0 flex-col border-t"
      style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)", backgroundColor: "rgba(13,9,22,0.92)" }}
    >
      {/* Drag edge — always a resize affordance when expanded, an expand
          affordance when collapsed. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={expanded ? "Resize LiTT panel" : "Expand LiTT panel"}
        data-testid="litt-layer-edge"
        onPointerDown={expanded ? onEdgeDown : undefined}
        onPointerMove={expanded ? onEdgeMove : undefined}
        onPointerUp={expanded ? onEdgeUp : undefined}
        onPointerCancel={expanded ? onEdgeUp : undefined}
        onClick={expanded ? undefined : () => onExpandedChange(true)}
        className="h-1.5 w-full shrink-0"
        style={{ cursor: expanded ? "ns-resize" : "s-resize" }}
      />

      {expanded && (
        <div className="flex min-h-0 flex-col" style={{ height }}>
          <div
            className="flex h-7 shrink-0 items-center gap-2 border-b px-3"
            style={{ borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
          >
            <Sparkles size={11} style={{ color: "var(--litt-primary)" }} aria-hidden />
            <span className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--text-secondary)" }}>
              LiTT
            </span>
            {busy && (
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: "var(--litt-primary)" }}
                aria-label="LiTT is working"
                data-testid="litt-layer-busy"
              />
            )}
            <span className="flex-1" />
            {dockPosition && onDockPositionChange && (
              <ChatDockSwitcher position={dockPosition} onChange={onDockPositionChange} />
            )}
            <button
              type="button"
              onClick={() => { onExpandedChange(false); persist(false, height); }}
              aria-label="Collapse LiTT panel (Esc)"
              title="Collapse (Esc)"
              data-testid="litt-layer-collapse"
              className="flex h-5 w-5 items-center justify-center rounded text-[10px] transition-colors hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
            >
              <ChevronDown size={12} className="pointer-events-none" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden" data-testid="litt-layer-transcript">
            {transcript}
          </div>
        </div>
      )}

      {statusBar}

      <div className="flex shrink-0 items-stretch gap-1 px-1 pb-1">
        <button
          type="button"
          onClick={() => { const next = !expanded; onExpandedChange(next); persist(next, height); }}
          aria-label={expanded ? "Collapse LiTT panel" : "Expand LiTT panel"}
          aria-expanded={expanded}
          title={expanded ? "Collapse transcript" : "Show transcript"}
          data-testid="litt-layer-toggle"
          className="mx-1 flex w-6 shrink-0 items-center justify-center self-center rounded transition-colors hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          {expanded
            ? <ChevronDown size={14} className="pointer-events-none" />
            : <ChevronUp size={14} className="pointer-events-none" />}
        </button>
        <div className="min-w-0 flex-1">{composer}</div>
      </div>
    </section>
  );
}
